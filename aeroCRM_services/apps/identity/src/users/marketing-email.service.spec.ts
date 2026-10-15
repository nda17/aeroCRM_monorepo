import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MarketingEmailService, MARKETING_EMAIL_CONSENT_TEXT_VERSION } from './marketing-email.service';

const USER_ID = 'user-1';
const EMAIL_ID = 'email-1';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function harness() {
	const verifiedAt = new Date('2026-10-15T08:00:00.000Z');
	const user: any = {
		id: USER_ID,
		status: 'ACTIVE',
		deletedAt: null,
		personalDataConsentRevokedAt: null,
		authIdentities: [{ id: EMAIL_ID, userId: USER_ID, type: 'EMAIL', value: 'User@example.com', verifiedAt }],
		marketingEmailPreference: null
	};
	const tokens: any[] = [];
	const receipts = new Map<string, any>();
	const audits = jest.fn().mockResolvedValue(undefined);
	const tokenCreate = jest.fn(async ({ data }: any) => { tokens.push({ ...data, consumedAt: null }); });
	const tx: any = {
		$queryRaw: jest.fn().mockResolvedValue([]),
		user: {
			findUnique: jest.fn(async () => user),
			findUniqueOrThrow: jest.fn(async () => user)
		},
		internalCommandReceipt: {
			findUnique: jest.fn(async ({ where }: any) => receipts.get(where.client_command_idempotencyKey.idempotencyKey) ?? null),
			create: jest.fn(async ({ data }: any) => { receipts.set(data.idempotencyKey, data); })
		},
		marketingEmailPreference: {
			upsert: jest.fn(async ({ create, update }: any) => {
				if (!user.marketingEmailPreference) user.marketingEmailPreference = { ...create, updatedAt: new Date() };
				else user.marketingEmailPreference = {
					...user.marketingEmailPreference,
					...update,
					version: user.marketingEmailPreference.version + update.version.increment,
					updatedAt: new Date()
				};
				return user.marketingEmailPreference;
			}),
			findUnique: jest.fn(async () => user.marketingEmailPreference),
			update: jest.fn(async ({ data }: any) => {
				user.marketingEmailPreference = {
					...user.marketingEmailPreference,
					...data,
					version: user.marketingEmailPreference.version + data.version.increment,
					updatedAt: new Date()
				};
				return user.marketingEmailPreference;
			})
		},
		marketingUnsubscribeToken: {
			create: tokenCreate,
			findUnique: jest.fn(async ({ where }: any) => tokens.find(token => token.tokenHash === where.tokenHash) ?? null),
			updateMany: jest.fn(async ({ where, data }: any) => {
				const token = tokens.find(item => item.tokenHash === where.tokenHash && item.consumedAt === null);
				if (!token) return { count: 0 };
				token.consumedAt = data.consumedAt;
				return { count: 1 };
			})
		},
		authIdentity: { findUnique: jest.fn(async ({ where }: any) => user.authIdentities.find((email: any) => email.id === where.id)) }
	};
	const prisma = { $transaction: jest.fn(async (callback: (transaction: any) => Promise<any>) => callback(tx)) };
	const events = { emitAudit: audits };
	const config = { get: jest.fn((key: string) => key === 'MARKETING_EMAIL_ENABLED' ? 'true' : 'https://aerocrm.space') };
	const service = new MarketingEmailService(prisma as any, events as any, config as any);
	const emailBinding = () => hash(JSON.stringify({
		authIdentityId: EMAIL_ID,
		normalizedEmail: 'user@example.com',
		verifiedAt: verifiedAt.toISOString()
	}));
	const command = (overrides: Record<string, unknown> = {}) => ({
		schemaVersion: 1,
		commandId: '44444444-4444-4444-8444-444444444444',
		expectedVersion: 0,
		expectedEmailBinding: emailBinding(),
		enabled: true,
		consentTextVersion: MARKETING_EMAIL_CONSENT_TEXT_VERSION,
		...overrides
	});
	const event = { schemaVersion: 1, eventId: EVENT_ID, campaignId: CAMPAIGN_ID, deliveryId: DELIVERY_ID,
		dispatchGeneration: 1, recipientUserId: USER_ID, destination: 'user@example.com' };
	return { service, user, tokens, receipts, audits, tokenCreate, tx, emailBinding, command, event };
}

describe('MarketingEmailService consent and unsubscribe lifecycle', () => {
	it('defaults to off and refuses audience authorization without explicit consent', async () => {
		const h = harness();
		const profile = await h.service.profile(USER_ID);
		expect(profile).toMatchObject({ enabled: false, version: 0, emailVerified: true });
		expect(await h.service.authorize(h.event)).toEqual({ schemaVersion: 1, decision: 'SKIP', reason: 'MARKETING_NOT_AUTHORIZED' });
		expect(h.tokenCreate).not.toHaveBeenCalled();
	});

	it('invalidates consent when the verified email identity or its binding changes', async () => {
		const h = harness();
		await h.service.update(USER_ID, h.command(), '44444444-4444-4444-8444-444444444444');
		const oldBinding = h.emailBinding();
		h.user.authIdentities[0] = {
			id: 'email-2', userId: USER_ID, type: 'EMAIL', value: 'new@example.com', verifiedAt: new Date('2026-10-15T08:00:00.000Z')
		};
		const profile = await h.service.profile(USER_ID);
		expect(profile.enabled).toBe(false);
		expect(profile.emailBinding).not.toBe(oldBinding);
		await expect(h.service.update(USER_ID, h.command({ expectedVersion: 1, expectedEmailBinding: oldBinding }),
			'44444444-4444-4444-8444-444444444444')).rejects.toBeInstanceOf(ConflictException);
	});

	it('recovers a lost response by exact command receipt and rejects command reuse with changed payload', async () => {
		const h = harness();
		const dto = h.command();
		const first = await h.service.update(USER_ID, dto, dto.commandId);
		const replay = await h.service.update(USER_ID, { ...dto }, dto.commandId);
		expect(replay).toEqual(first);
		expect(h.tx.marketingEmailPreference.upsert).toHaveBeenCalledTimes(1);
		expect(h.audits).toHaveBeenCalledTimes(1);
		await expect(h.service.update(USER_ID, { ...dto, enabled: false }, dto.commandId)).rejects.toBeInstanceOf(ConflictException);
	});

	it('turns queued delivery authorization into an unsubscribe, then protects a later re-opt-in from token replay', async () => {
		const h = harness();
		const enable = h.command();
		await h.service.update(USER_ID, enable, enable.commandId);
		const allowed = await h.service.authorize(h.event);
		expect(allowed).toMatchObject({ decision: 'ALLOW' });
		const url = (allowed as { unsubscribeUrl: string }).unsubscribeUrl;
		const token = new URL(url).hash.slice('#token='.length);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		await h.service.unsubscribe(token);
		expect((await h.service.profile(USER_ID)).enabled).toBe(false);
		const reenable = h.command({ commandId: '55555555-5555-4555-8555-555555555555', expectedVersion: 2 });
		await h.service.update(USER_ID, reenable, reenable.commandId);
		await h.service.unsubscribe(token);
		expect((await h.service.profile(USER_ID)).enabled).toBe(true);
		expect(h.tx.marketingUnsubscribeToken.updateMany).toHaveBeenCalledTimes(2);
	});
});
