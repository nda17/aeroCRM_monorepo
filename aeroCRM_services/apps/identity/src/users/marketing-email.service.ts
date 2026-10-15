import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/identity-client';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { IdentityPrismaService } from '../prisma/identity-prisma.service';
import { IdentityEventsService } from '../events/identity-events.service';

export const MARKETING_EMAIL_CONSENT_TEXT_VERSION = 'marketing-email-v1';
export const MARKETING_EMAIL_CAPABILITIES = { profile: 1, authorization: 1, unsubscribe: 1, binding: 1 } as const;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface MarketingEmailCommand {
	schemaVersion: 1;
	commandId: string;
	expectedVersion: number;
	expectedEmailBinding: string | null;
	enabled: boolean;
	consentTextVersion: string;
}

@Injectable()
export class MarketingEmailService {
	constructor(
		private readonly prisma: IdentityPrismaService,
		private readonly events: IdentityEventsService,
		private readonly config: ConfigService
	) {}

	async profile(userId: string) {
		return this.prisma.$transaction(tx => this.read(tx, userId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	private async read(tx: Prisma.TransactionClient, userId: string) {
		const user = await tx.user.findUnique({
			where: { id: userId },
			include: { authIdentities: true, marketingEmailPreference: true }
		});
		if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt)
			throw new ForbiddenException('Account is not active');
		const email = user.authIdentities.find(item => item.type === 'EMAIL');
		const normalizedEmail = email?.value.trim().toLowerCase() || null;
		const verified = Boolean(normalizedEmail && email?.verifiedAt);
		const binding = verified ? hash(JSON.stringify({
			authIdentityId: email!.id,
			normalizedEmail,
			verifiedAt: email!.verifiedAt!.toISOString()
		})) : null;
		const preference = user.marketingEmailPreference;
		const enabled = Boolean(
			preference?.enabled && !user.personalDataConsentRevokedAt && verified &&
			preference.boundAuthIdentityId === email?.id &&
			preference.boundEmailHash === hash(normalizedEmail!) &&
			preference.boundVerifiedAt?.getTime() === email?.verifiedAt?.getTime() &&
			preference.consentTextVersion === MARKETING_EMAIL_CONSENT_TEXT_VERSION
		);
		return {
			schemaVersion: 1 as const,
			version: preference?.version || 0,
			enabled,
			email: normalizedEmail,
			emailVerified: verified,
			emailBinding: binding,
			consentTextVersion: MARKETING_EMAIL_CONSENT_TEXT_VERSION,
			consentedAt: preference?.consentedAt?.toISOString() || null,
			updatedAt: preference?.updatedAt.toISOString() || null
		};
	}

	async update(userId: string, value: unknown, idempotencyKey?: string) {
		const dto = parseMarketingEmailCommand(value);
		if (idempotencyKey !== dto.commandId)
			throw new BadRequestException('Idempotency-Key must equal commandId');
		const requestHash = hash(JSON.stringify({ schemaVersion: dto.schemaVersion,
			commandId: dto.commandId, expectedVersion: dto.expectedVersion,
			expectedEmailBinding: dto.expectedEmailBinding, enabled: dto.enabled,
			consentTextVersion: dto.consentTextVersion }));
		return this.prisma.$transaction(async tx => {
			await tx.$queryRaw`SELECT id FROM identity.users WHERE id = ${userId} FOR UPDATE`;
			await tx.$queryRaw`SELECT id FROM identity.auth_identities WHERE user_id = ${userId} AND type = 'EMAIL'::identity."AuthIdentityType" FOR UPDATE`;
			const current = await this.read(tx, userId);
			const client = `marketing-email:${userId}`;
			const existing = await tx.internalCommandReceipt.findUnique({ where: {
				client_command_idempotencyKey: { client, command: 'UPDATE', idempotencyKey: dto.commandId }
			} });
			if (existing) {
				if (existing.requestHash !== requestHash)
					throw new ConflictException('Command was used with a different request');
				return existing.response;
			}
			if (dto.expectedVersion !== current.version || dto.expectedEmailBinding !== current.emailBinding ||
				dto.consentTextVersion !== MARKETING_EMAIL_CONSENT_TEXT_VERSION)
				throw new ConflictException('Marketing email preference changed; reload the profile');
			const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { authIdentities: true } });
			if (dto.enabled && (!current.emailVerified || user.personalDataConsentRevokedAt))
				throw new ConflictException('A verified email and active personal data consent are required');
			const email = user.authIdentities.find(item => item.type === 'EMAIL');
			await tx.marketingEmailPreference.upsert({
				where: { userId },
				create: { userId, enabled: dto.enabled, version: 1,
					boundAuthIdentityId: email?.id, boundEmailHash: current.email ? hash(current.email) : null,
					boundVerifiedAt: email?.verifiedAt, consentTextVersion: MARKETING_EMAIL_CONSENT_TEXT_VERSION,
					consentedAt: dto.enabled ? new Date() : null },
				update: { enabled: dto.enabled, version: { increment: 1 },
					boundAuthIdentityId: email?.id, boundEmailHash: current.email ? hash(current.email) : null,
					boundVerifiedAt: email?.verifiedAt, consentTextVersion: MARKETING_EMAIL_CONSENT_TEXT_VERSION,
					consentedAt: dto.enabled ? new Date() : null }
			});
			const response = await this.read(tx, userId);
			await this.events.emitAudit(tx, { actorId: userId, action: 'MARKETING_EMAIL_CONSENT_UPDATE',
				entityType: 'user', entityId: userId, targetUserId: userId,
				description: 'Marketing email preference updated', metadata: {
					enabled: dto.enabled, version: response.version,
					consentTextVersion: MARKETING_EMAIL_CONSENT_TEXT_VERSION, source: 'PROFILE',
					boundAuthIdentityId: email?.id || null, boundEmailHash: current.email ? hash(current.email) : null,
					boundVerifiedAt: email?.verifiedAt?.toISOString() || null
				} });
			await tx.internalCommandReceipt.create({ data: { client, command: 'UPDATE',
				idempotencyKey: dto.commandId, requestHash, response } });
			return response;
		});
	}

	async authorize(value: unknown) {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new BadRequestException('Invalid marketing authorization');
		const row = value as Record<string, unknown>;
		const uuid = (item: unknown) => typeof item === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item);
		if (Object.keys(row).sort().join(',') !== 'campaignId,deliveryId,destination,dispatchGeneration,eventId,recipientUserId,schemaVersion' ||
			row.schemaVersion !== 1 || !uuid(row.eventId) || !uuid(row.campaignId) || !uuid(row.deliveryId) ||
			!Number.isSafeInteger(row.dispatchGeneration) || Number(row.dispatchGeneration) < 1 ||
			typeof row.recipientUserId !== 'string' || !row.recipientUserId || row.recipientUserId.length > 255 ||
			typeof row.destination !== 'string' || row.destination.length > 254 || row.destination !== row.destination.trim().toLowerCase())
			throw new BadRequestException('Invalid marketing authorization');
		const userId = row.recipientUserId;
		const skip = (reason: string) => ({ schemaVersion: 1 as const, decision: 'SKIP' as const, reason });
		if (this.config.get<string>('MARKETING_EMAIL_ENABLED') !== 'true') return skip('MARKETING_NOT_AUTHORIZED');
		const origin = this.publicOrigin();
		return this.prisma.$transaction(async tx => {
			await tx.$queryRaw`SELECT id FROM identity.users WHERE id = ${userId} FOR UPDATE`;
			await tx.$queryRaw`SELECT id FROM identity.auth_identities WHERE user_id = ${userId} AND type = 'EMAIL'::identity."AuthIdentityType" FOR UPDATE`;
			const user = await tx.user.findUnique({ where: { id: userId }, include: { authIdentities: true } });
			if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt || user.personalDataConsentRevokedAt)
				return skip('MARKETING_NOT_AUTHORIZED');
			const email = user.authIdentities.find(item => item.type === 'EMAIL');
			if (!email?.verifiedAt || email.value.trim().toLowerCase() !== row.destination)
				return skip('MARKETING_IDENTITY_MISMATCH');
			const profile = await this.read(tx, userId);
			if (!profile.enabled) return skip('MARKETING_NOT_AUTHORIZED');
			const token = randomBytes(32).toString('base64url');
			await tx.marketingUnsubscribeToken.create({ data: {
				tokenHash: hash(token), userId, authIdentityId: email.id,
				emailHash: hash(profile.email!), verifiedAt: email.verifiedAt,
				eventId: row.eventId as string, deliveryId: row.deliveryId as string
			} });
			return { schemaVersion: 1 as const, decision: 'ALLOW' as const,
				preferenceVersion: profile.version, checkedAt: new Date().toISOString(),
				unsubscribeUrl: `${origin}/unsubscribe#token=${token}` };
		});
	}

	private publicOrigin(): string {
		const raw = this.config.get<string>('MARKETING_PUBLIC_ORIGIN');
		let origin: URL;
		try { origin = new URL(raw || ''); } catch { throw new Error('Marketing public origin is unavailable'); }
		if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash ||
			origin.pathname !== '/' || raw !== origin.origin)
			throw new Error('Invalid marketing public origin');
		return origin.origin;
	}

	async unsubscribe(token: unknown) {
		const response = { ok: true as const };
		if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return response;
		const tokenHash = hash(token);
		return this.prisma.$transaction(async tx => {
			const found = await tx.marketingUnsubscribeToken.findUnique({ where: { tokenHash } });
			if (!found) return response;
			await tx.$queryRaw`SELECT id FROM identity.users WHERE id = ${found.userId} FOR UPDATE`;
			const consumed = await tx.marketingUnsubscribeToken.updateMany({
				where: { tokenHash, consumedAt: null }, data: { consumedAt: new Date() }
			});
			if (consumed.count !== 1) return response;
			await tx.$queryRaw`SELECT id FROM identity.auth_identities WHERE user_id = ${found.userId} AND type = 'EMAIL'::identity."AuthIdentityType" FOR UPDATE`;
			const email = await tx.authIdentity.findUnique({ where: { id: found.authIdentityId } });
			if (!email || email.type !== 'EMAIL' || email.userId !== found.userId ||
				hash(email.value.trim().toLowerCase()) !== found.emailHash ||
				email.verifiedAt?.getTime() !== found.verifiedAt.getTime()) return response;
			const preference = await tx.marketingEmailPreference.findUnique({ where: { userId: found.userId } });
			if (!preference || !preference.enabled || preference.boundAuthIdentityId !== email.id ||
				preference.boundEmailHash !== found.emailHash || preference.boundVerifiedAt?.getTime() !== found.verifiedAt.getTime()) return response;
			const updated = await tx.marketingEmailPreference.update({
				where: { userId: found.userId }, data: { enabled: false, version: { increment: 1 } }
			});
			await this.events.emitAudit(tx, { actorId: found.userId, action: 'MARKETING_EMAIL_CONSENT_UPDATE',
				entityType: 'user', entityId: found.userId, targetUserId: found.userId,
				description: 'Marketing email unsubscribe', metadata: { enabled: false, version: updated.version,
					consentTextVersion: updated.consentTextVersion, source: 'UNSUBSCRIBE',
					boundAuthIdentityId: found.authIdentityId, boundEmailHash: found.emailHash, boundVerifiedAt: found.verifiedAt.toISOString() } });
			return response;
		});
	}

}

export function parseMarketingEmailCommand(value: unknown): MarketingEmailCommand {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new BadRequestException('Invalid marketing email command');
		const row = value as Record<string, unknown>;
		if (Object.keys(row).sort().join(',') !== 'commandId,consentTextVersion,enabled,expectedEmailBinding,expectedVersion,schemaVersion' ||
			row.schemaVersion !== 1 || typeof row.commandId !== 'string' ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.commandId) ||
			!Number.isSafeInteger(row.expectedVersion) || Number(row.expectedVersion) < 0 || Number(row.expectedVersion) > 2147483646 ||
			(row.expectedEmailBinding !== null && (typeof row.expectedEmailBinding !== 'string' || !/^[0-9a-f]{64}$/.test(row.expectedEmailBinding))) ||
			typeof row.enabled !== 'boolean' || typeof row.consentTextVersion !== 'string' || row.consentTextVersion.length > 64)
			throw new BadRequestException('Invalid marketing email command');
		return row as unknown as MarketingEmailCommand;
	}
