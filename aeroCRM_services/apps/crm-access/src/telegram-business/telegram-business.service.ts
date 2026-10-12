import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type TelegramChannel, type TelegramConnectSession } from '@prisma/crm-access-client';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import { collaborationSignal } from '../directory/directory.util';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { command, semanticHash } from '../team/team.util';
import { TelegramBusinessBot } from './telegram-business.bot';

type Actor = Awaited<ReturnType<CrmAuthorizationService['authorize']>> & { membershipId: string };
type CommandDto = { workspaceId: string; commandId: string; expectedVersion: number };

@Injectable()
export class TelegramBusinessService {
	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly auth: CrmAuthorizationService,
		private readonly bot: TelegramBusinessBot
	) {}

	private async actor(token: string | undefined, workspaceId: string, tx?: Prisma.TransactionClient): Promise<Actor> {
		const authority = await this.auth.authorize(token, workspaceId, undefined, tx);
		const binding = await this.auth.assignmentSubject(workspaceId, authority.subject);
		return { ...authority, membershipId: binding.membershipId };
	}

	private manage(actor: Actor) {
		if (actor.state === 'READ_ONLY' || !['OWNER', 'CRM_ADMIN'].includes(actor.role))
			throw new ForbiddenException('Telegram channel management is not available');
	}

	private startToken(id: string): string {
		const compact = id.replace(/-/g, '');
		const mac = createHmac('sha256', this.bot.secret).update(`telegram-start-v1:${id}`).digest('base64url').slice(0, 24);
		return `${compact}_${mac}`;
	}

	parseStartToken(token: string): string | null {
		if (!/^[a-f0-9]{32}_[A-Za-z0-9_-]{24}$/.test(token)) return null;
		const compact = token.slice(0, 32);
		const id = `${compact.slice(0,8)}-${compact.slice(8,12)}-${compact.slice(12,16)}-${compact.slice(16,20)}-${compact.slice(20)}`;
		const expected = this.startToken(id);
		if (!timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return null;
		return id;
	}

	callbackData(id: string): string {
		const signature = createHmac('sha256', this.bot.secret).update(`telegram-confirm-v1:${id}`).digest('base64url').slice(0, 16);
		return `confirm:${id}:${signature}`;
	}

	parseCallbackData(value: string): string | null {
		const match = /^confirm:([a-f0-9-]{36}):([A-Za-z0-9_-]{16})$/.exec(value);
		if (!match) return null;
		const expected = this.callbackData(match[1]);
		return timingSafeEqual(Buffer.from(value), Buffer.from(expected)) ? match[1] : null;
	}

	private channelDto(row: TelegramChannel) {
		return { id: row.id, version: row.version, status: row.status,
			account: { id: row.ownerUserId, displayName: row.ownerName, username: row.ownerUsername },
			canReply: row.canReply, connectedAt: row.connectedAt.toISOString(),
			lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
			lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
			disconnectedAt: row.disconnectedAt?.toISOString() ?? null, lastErrorCode: row.lastErrorCode };
	}

	private sessionDto(row: TelegramConnectSession, actor: Actor) {
		const live = row.expiresAt.getTime() > Date.now() && !['CONNECTED','CANCELLED','EXPIRED'].includes(row.state);
		return { id: row.id, state: live ? row.state : row.state === 'CONNECTED' || row.state === 'CANCELLED' ? row.state : 'EXPIRED', version: row.version,
			expiresAt: row.expiresAt.toISOString(),
			deepLink: live && row.actorSubject === actor.subject && row.actorMembershipId === actor.membershipId
				? `https://t.me/${this.bot.username}?start=${this.startToken(row.id)}` : null,
			owner: row.telegramUserId ? { id: row.telegramUserId, displayName: row.ownerName || 'Telegram', username: row.ownerUsername } : null,
			channelId: row.channelId, errorCode: null };
	}

	async channels(token: string | undefined, workspaceId: string) {
		const actor = await this.actor(token, workspaceId);
		const rows = await this.prisma.telegramChannel.findMany({ where: { workspaceId }, orderBy: { connectedAt: 'desc' } });
		return { schemaVersion: 1, workspaceId, subject: actor.subject, configured: this.bot.configured,
			botUsername: this.bot.username || null, canManage: actor.state !== 'READ_ONLY' && ['OWNER','CRM_ADMIN'].includes(actor.role), items: rows.map(row => this.channelDto(row)) };
	}

	async createSession(token: string | undefined, dto: { workspaceId: string; commandId: string; channelId?: string }) {
		const actor = await this.actor(token, dto.workspaceId);
		this.manage(actor);
		if (!this.bot.configured) throw new ForbiddenException('Telegram Business is not enabled');
		const result = await command(this.prisma, actor, dto.commandId, 'telegram.connect-session', { ...dto, membershipId: actor.membershipId }, async tx => {
			if (dto.channelId) {
				const channel = await tx.telegramChannel.findFirst({ where: { id: dto.channelId, workspaceId: actor.workspaceId } });
				if (!channel) throw new NotFoundException('Channel was not found');
			}
			const id = randomUUID();
			await tx.telegramConnectSession.create({ data: { id, workspaceId: actor.workspaceId, actorSubject: actor.subject,
				actorMembershipId: actor.membershipId, commandId: dto.commandId, channelId: dto.channelId ?? null,
				nonceHash: createHash('sha256').update(this.startToken(id)).digest('hex'), expiresAt: new Date(Date.now() + 10 * 60_000) } });
			return { id };
		}, async tx => { const fresh = await this.actor(token, actor.workspaceId, tx); this.manage(fresh); if (fresh.membershipId !== actor.membershipId) throw new ForbiddenException('Membership changed'); });
		return this.session(token, result.id, dto.workspaceId);
	}

	async session(token: string | undefined, id: string, workspaceId: string) {
		const actor = await this.actor(token, workspaceId);
		const row = await this.prisma.telegramConnectSession.findFirst({ where: { id, workspaceId } });
		if (!row || row.actorSubject !== actor.subject || row.actorMembershipId !== actor.membershipId)
			throw new NotFoundException('Connect session was not found');
		return { schemaVersion: 1, workspaceId, subject: actor.subject, item: this.sessionDto(row, actor) };
	}

	async cancelSession(token: string | undefined, id: string, dto: CommandDto) {
		const actor = await this.actor(token, dto.workspaceId); this.manage(actor);
		const result = await command(this.prisma, actor, dto.commandId, 'telegram.cancel-session', { ...dto, id, membershipId: actor.membershipId }, async tx => {
			const row = await tx.telegramConnectSession.findFirst({ where: { id, workspaceId: actor.workspaceId } });
			if (!row || row.actorSubject !== actor.subject || row.actorMembershipId !== actor.membershipId) throw new NotFoundException('Connect session was not found');
			if (row.version !== dto.expectedVersion) throw new ConflictException('Connect session changed');
			if (row.state === 'CONNECTED') throw new ConflictException('Channel is already connected');
			const updated = await tx.telegramConnectSession.update({ where: { id }, data: { state: 'CANCELLED', version: { increment: 1 } } });
			return { id: updated.id };
		}, async tx => { const fresh = await this.actor(token, actor.workspaceId, tx); this.manage(fresh); if (fresh.membershipId !== actor.membershipId) throw new ForbiddenException('Membership changed'); });
		return this.session(token, result.id, dto.workspaceId);
	}

	async confirmSession(token: string | undefined, id: string, dto: CommandDto) {
		const actor = await this.actor(token, dto.workspaceId); this.manage(actor);
		const prior = await this.prisma.crmTeamCommandReceipt.findUnique({ where: { commandId: dto.commandId } });
		if (prior) {
			const hash = semanticHash({ actor: actor.subject, workspaceId: actor.workspaceId, commandType: 'telegram.confirm-session', body: { ...dto, id, membershipId: actor.membershipId } });
			if (prior.workspaceId !== actor.workspaceId || prior.actorSubject !== actor.subject || prior.commandType !== 'telegram.confirm-session' || prior.requestHash !== hash)
				throw new ConflictException('Telegram command conflict');
			return this.session(token, id, dto.workspaceId);
		}
		const preview = await this.prisma.telegramConnectSession.findFirst({ where: { id, workspaceId: dto.workspaceId } });
		if (!preview || !preview.connectionId || !preview.telegramUserId || !['CONNECTION_READY','OWNER_VERIFIED'].includes(preview.state) || preview.expiresAt.getTime() <= Date.now())
			throw new ConflictException('Telegram connection is not ready');
		const provider = await this.bot.getConnection(preview.connectionId);
		if (!provider.is_enabled || String(provider.user.id) !== preview.telegramUserId || !(provider.rights?.can_reply ?? provider.can_reply ?? false))
			throw new ConflictException('Telegram connection cannot reply');
		await command(this.prisma, actor, dto.commandId, 'telegram.confirm-session', { ...dto, id, membershipId: actor.membershipId }, async tx => {
			const row = await tx.telegramConnectSession.findFirst({ where: { id, workspaceId: actor.workspaceId } });
			if (!row || row.actorSubject !== actor.subject || row.actorMembershipId !== actor.membershipId) throw new NotFoundException('Connect session was not found');
			if (row.version !== dto.expectedVersion || row.connectionId !== provider.id || row.telegramUserId !== String(provider.user.id) || row.expiresAt.getTime() <= Date.now() || row.state !== 'CONNECTION_READY')
				throw new ConflictException('Connect session changed');
			const name = [provider.user.first_name, provider.user.last_name].filter(Boolean).join(' ') || row.ownerName || 'Telegram';
			let channel: TelegramChannel;
			if (row.channelId) {
				const prior = await tx.telegramChannel.findFirst({ where: { id: row.channelId, workspaceId: actor.workspaceId } });
				if (!prior || prior.ownerUserId !== row.telegramUserId) throw new ConflictException('Reconnect owner differs');
				channel = await tx.telegramChannel.update({ where: { id: prior.id }, data: { connectionId: provider.id, ownerName: name, ownerUsername: provider.user.username ?? null,
					generation: { increment: 1 }, version: { increment: 1 }, status: 'ACTIVE', canReply: true, connectedAt: new Date(), disconnectedAt: null, lastInboundAt: null, lastOutboundAt: null, lastErrorCode: null } });
				const queued = await tx.telegramDelivery.findMany({ where: { channelId: channel.id, state: 'QUEUED' }, select: { messageId: true } });
				await tx.telegramDelivery.updateMany({ where: { channelId: channel.id, state: 'QUEUED' }, data: { state: 'CANCELLED', lastErrorCode: 'CHANNEL_RECONNECTED' } });
				await tx.telegramMessage.updateMany({ where: { id: { in: queued.map(item => item.messageId) } }, data: { deliveryStatus: 'CANCELLED' } });
			} else {
				channel = await tx.telegramChannel.create({ data: { workspaceId: actor.workspaceId, ownerUserId: row.telegramUserId,
					ownerName: name, ownerUsername: provider.user.username ?? null, connectionId: provider.id, status: 'ACTIVE', canReply: true } });
			}
			await tx.telegramConnectSession.update({ where: { id }, data: { state: 'CONNECTED', channelId: channel.id, version: { increment: 1 } } });
			await collaborationSignal(tx, actor.workspaceId);
			return { channelId: channel.id };
		}, async tx => { const fresh = await this.actor(token, actor.workspaceId, tx); this.manage(fresh); if (fresh.membershipId !== actor.membershipId) throw new ForbiddenException('Membership changed'); });
		return this.session(token, id, dto.workspaceId);
	}

	async disconnect(token: string | undefined, id: string, dto: CommandDto) {
		const actor = await this.actor(token, dto.workspaceId); this.manage(actor);
		const result = await command(this.prisma, actor, dto.commandId, 'telegram.disconnect', { ...dto, id, membershipId: actor.membershipId }, async tx => {
			const row = await tx.telegramChannel.findFirst({ where: { id, workspaceId: actor.workspaceId } });
			if (!row) throw new NotFoundException('Channel was not found');
			if (row.version !== dto.expectedVersion) throw new ConflictException('Channel changed');
			const updated = await tx.telegramChannel.update({ where: { id }, data: { status: 'DISCONNECTED', version: { increment: 1 }, generation: { increment: 1 }, canReply: false, disconnectedAt: new Date(), lastInboundAt: null, lastOutboundAt: null } });
			const queued = await tx.telegramDelivery.findMany({ where: { channelId: id, state: 'QUEUED' }, select: { messageId: true } });
			await tx.telegramDelivery.updateMany({ where: { channelId: id, state: 'QUEUED' }, data: { state: 'CANCELLED', lastErrorCode: 'CHANNEL_DISCONNECTED' } });
			await tx.telegramMessage.updateMany({ where: { id: { in: queued.map(item => item.messageId) } }, data: { deliveryStatus: 'CANCELLED' } });
			await collaborationSignal(tx, actor.workspaceId);
			return { channelId: updated.id };
		}, async tx => { const fresh = await this.actor(token, actor.workspaceId, tx); this.manage(fresh); if (fresh.membershipId !== actor.membershipId) throw new ForbiddenException('Membership changed'); });
		const row = await this.prisma.telegramChannel.findUniqueOrThrow({ where: { id: result.channelId } });
		return { schemaVersion: 1, workspaceId: actor.workspaceId, subject: actor.subject, item: this.channelDto(row) };
	}

	async reply(token: string | undefined, sourceMessageId: string, dto: { workspaceId: string; commandId: string; text: string }) {
		const actor = await this.actor(token, dto.workspaceId);
		if (actor.state === 'READ_ONLY') throw new ForbiddenException('Messenger is read-only');
		const text = dto.text.trim();
		if (!text || text.length > 4096) throw new BadRequestException('Invalid Telegram reply text');
		return command(this.prisma, actor, dto.commandId, 'telegram.reply', { ...dto, text, sourceMessageId, membershipId: actor.membershipId }, async tx => {
			const source = await tx.telegramMessage.findFirst({ where: { id: sourceMessageId, workspaceId: actor.workspaceId, direction: 'INBOUND', origin: 'CUSTOMER', deletedAt: null } });
			if (!source) throw new NotFoundException('Telegram message was not found');
			const channel = await tx.telegramChannel.findFirst({ where: { id: source.channelId, workspaceId: actor.workspaceId } });
			const dialog = await tx.telegramDialog.findFirst({ where: { id: source.dialogId, workspaceId: actor.workspaceId } });
			if (!channel || !dialog || channel.status !== 'ACTIVE' || !channel.canReply || !dialog.lastInboundAt || dialog.lastInboundAt.getTime() + 24 * 60 * 60_000 <= Date.now())
				throw new ForbiddenException('Telegram reply is unavailable');
			const profile = await tx.crmDirectoryEntry.findUnique({ where: { workspaceId_subject: { workspaceId: actor.workspaceId, subject: actor.subject } } });
			const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || 'Сотрудник';
			const message = await tx.telegramMessage.create({ data: { workspaceId: actor.workspaceId, channelId: channel.id, dialogId: dialog.id,
				providerChatId: dialog.providerChatId, direction: 'OUTBOUND', origin: 'CRM', contentKind: 'TEXT', authorName: name,
				actorSubject: actor.subject, actorMembershipId: actor.membershipId, text, deliveryStatus: 'QUEUED' } });
			const stream = await tx.workspaceMessengerStream.upsert({ where: { workspaceId: actor.workspaceId }, create: { workspaceId: actor.workspaceId, lastSequence: 1 }, update: { lastSequence: { increment: 1 } } });
			await tx.workspaceMessengerEntry.create({ data: { workspaceId: actor.workspaceId, sequence: stream.lastSequence, kind: 'TELEGRAM_OUTBOUND', telegramMessageId: message.id } });
			await tx.telegramDelivery.create({ data: { commandId: dto.commandId, workspaceId: actor.workspaceId, actorSubject: actor.subject, actorMembershipId: actor.membershipId,
				requestHash: semanticHash({ sourceMessageId, text, membershipId: actor.membershipId }), sourceMessageId, messageId: message.id,
				channelId: channel.id, channelGeneration: channel.generation, dialogId: dialog.id, connectionId: channel.connectionId, providerChatId: dialog.providerChatId } });
			await collaborationSignal(tx, actor.workspaceId);
			return { schemaVersion: 1, workspaceId: actor.workspaceId, subject: actor.subject, commandId: dto.commandId, messageId: message.id, deliveryStatus: 'QUEUED' };
		}, async tx => { const fresh = await this.actor(token, actor.workspaceId, tx); if (fresh.membershipId !== actor.membershipId || fresh.state === 'READ_ONLY') throw new ForbiddenException('Membership changed'); });
	}

	async commandStatus(token: string | undefined, workspaceId: string, commandId: string) {
		const actor = await this.actor(token, workspaceId);
		const row = await this.prisma.telegramDelivery.findUnique({ where: { commandId } });
		if (!row || row.workspaceId !== workspaceId || row.actorSubject !== actor.subject || row.actorMembershipId !== actor.membershipId)
			throw new NotFoundException('Command was not found');
		return { schemaVersion: 1, workspaceId, subject: actor.subject, commandId, messageId: row.messageId, deliveryStatus: row.state };
	}
}
