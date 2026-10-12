import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TelegramWebhookInbox, TelegramDelivery } from '@prisma/crm-access-client';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import { collaborationSignal } from '../directory/directory.util';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { CrmAccessRuntimeService } from '../runtime/crm-access-runtime.service';
import { workspaceLock } from '../team/team.util';
import { TelegramBusinessBot, TelegramTransportError } from './telegram-business.bot';
import { TelegramBusinessService } from './telegram-business.service';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
const numericId = (value: unknown): string | null => typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null;
const displayName = (value: RecordValue | null): string => [string(value?.first_name), string(value?.last_name)].filter(Boolean).join(' ').slice(0, 302) || string(value?.username)?.slice(0, 302) || 'Telegram';
const inboundDate = (value: unknown): Date | null => {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
	const date = new Date(value * 1000);
	return date.getTime() > 0 && date.getTime() <= Date.now() + 60_000 ? date : null;
};
class MissingTelegramMessageError extends Error {}

@Injectable()
export class TelegramBusinessWorker implements OnModuleInit, OnApplicationShutdown {
	private timer: NodeJS.Timeout | null = null;
	private running = false;
	private stopping = false;
	private readonly logger = new Logger(TelegramBusinessWorker.name);

	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly auth: CrmAuthorizationService,
		private readonly runtime: CrmAccessRuntimeService,
		private readonly bot: TelegramBusinessBot,
		private readonly telegram: TelegramBusinessService
	) {}

	onModuleInit() {
		if (!this.runtime.telegramWorkerEnabled || !this.bot.configured) return;
		this.timer = setInterval(() => void this.tick(), 1000);
		this.timer.unref();
		void this.tick();
	}

	async onApplicationShutdown() {
		this.stopping = true;
		if (this.timer) clearInterval(this.timer);
		while (this.running) await new Promise(resolve => setTimeout(resolve, 25));
	}

	private async tick() {
		if (this.running || this.stopping) return;
		this.running = true;
		try {
			await this.processInbox();
			await this.processDeliveries();
		} catch (error) {
			this.logger.error(`Telegram worker tick failed: ${error instanceof Error ? error.name : 'unknown'}`);
		} finally { this.running = false; }
	}

	private async processInbox() {
		const rows = await this.prisma.telegramWebhookInbox.findMany({
			where: { OR: [{ state: 'PENDING', nextRunAt: { lte: new Date() } }, { state: 'PROCESSING', leaseUntil: { lt: new Date() } }] },
			orderBy: { updateId: 'asc' }, take: 20
		});
		for (const row of rows) {
			const token = randomUUID();
			const claim = await this.prisma.telegramWebhookInbox.updateMany({
				where: { id: row.id, state: row.state, ...(row.state === 'PROCESSING' ? { leaseUntil: { lt: new Date() } } : { nextRunAt: { lte: new Date() } }) },
				data: { state: 'PROCESSING', leaseToken: token, leaseUntil: new Date(Date.now() + 30_000), attempts: { increment: 1 } }
			});
			if (!claim.count) continue;
			try {
				await this.handleUpdate(row);
				await this.prisma.telegramWebhookInbox.updateMany({ where: { id: row.id, leaseToken: token }, data: { state: 'DONE', leaseToken: null, leaseUntil: null } });
			} catch (error) {
				const waitingForOriginal = error instanceof MissingTelegramMessageError;
				const dead = waitingForOriginal ? row.createdAt.getTime() + 7 * 24 * 60 * 60_000 < Date.now() : row.attempts >= 9;
				await this.prisma.telegramWebhookInbox.updateMany({ where: { id: row.id, leaseToken: token }, data: {
					state: dead ? 'DEAD' : 'PENDING', leaseToken: null, leaseUntil: null,
					nextRunAt: new Date(Date.now() + (waitingForOriginal ? 10_000 : Math.min(60_000, 1000 * 2 ** Math.min(row.attempts, 6)))),
					lastErrorCode: waitingForOriginal ? 'WAITING_ORIGINAL' : error instanceof Error ? error.name.slice(0, 80) : 'UNKNOWN'
				} });
			}
		}
	}

	private async handleUpdate(row: TelegramWebhookInbox) {
		const update = record(row.payload);
		if (!update) return;
		if (record(update.business_connection)) { await this.connectionUpdate(record(update.business_connection)!, row.updateId); return; }
		if (record(update.business_message)) { await this.businessMessage(record(update.business_message)!, false); return; }
		if (record(update.edited_business_message)) { await this.businessMessage(record(update.edited_business_message)!, true); return; }
		if (record(update.deleted_business_messages)) { await this.deletedMessages(record(update.deleted_business_messages)!); return; }
		if (record(update.callback_query)) { await this.callback(record(update.callback_query)!); return; }
		if (record(update.message)) { await this.botMessage(record(update.message)!); }
	}

	private async connectionUpdate(value: RecordValue, updateId: bigint) {
		const id = string(value.id);
		if (!id) return;
		await this.prisma.$transaction(async tx => {
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-connection:${id}`},0))`;
			const previous = await tx.telegramConnection.findUnique({ where: { connectionId: id } });
			// Telegram may reset update_id after a week of inactivity. Its payload
			// only triggers reconciliation; the current provider state is authority.
			let current: Awaited<ReturnType<TelegramBusinessBot['getConnection']>> | null;
			try { current = await this.bot.getConnection(id); }
			catch (error) {
				if (!(error instanceof TelegramTransportError) || error.kind !== 'REJECTED' || ![400, 403].includes(error.status ?? 0)) throw error;
				current = null;
			}
			if (!current && !previous) return;
			const userId = current ? String(current.user.id) : previous!.telegramUserId;
			const enabled = current?.is_enabled === true;
			const canReply = enabled && (current?.rights?.can_reply ?? current?.can_reply ?? false);
			const changed = !previous || previous.telegramUserId !== userId || previous.enabled !== enabled || previous.canReply !== canReply;
			await tx.telegramConnection.upsert({ where: { connectionId: id }, create: { connectionId: id, telegramUserId: userId, enabled, canReply, lastUpdateId: updateId },
				update: { telegramUserId: userId, enabled, canReply, lastUpdateId: updateId } });
			if (changed) {
				await tx.telegramConnectSession.updateMany({ where: { telegramUserId: userId, state: 'WAITING_TELEGRAM', expiresAt: { gt: new Date() } },
					data: { connectionId: enabled ? id : null, version: { increment: 1 } } });
				await tx.telegramConnectSession.updateMany({ where: { telegramUserId: userId, state: { in: ['OWNER_VERIFIED', 'CONNECTION_READY'] }, expiresAt: { gt: new Date() } },
					data: { connectionId: enabled ? id : null, state: enabled && canReply ? 'CONNECTION_READY' : 'OWNER_VERIFIED', version: { increment: 1 } } });
			}
			const channels = await tx.telegramChannel.findMany({ where: { connectionId: id } });
			for (const channel of channels) {
				if (channel.status === 'DISCONNECTED' || channel.status === 'REVOKED') continue;
				const ownerMatches = channel.ownerUserId === userId;
				const active = enabled && canReply && ownerMatches;
				const status = !enabled || !ownerMatches ? 'REVOKED' : canReply ? 'ACTIVE' : 'DEGRADED';
				if (channel.status === status && channel.canReply === active) continue;
				await tx.telegramChannel.update({ where: { id: channel.id }, data: { canReply: active, status, version: { increment: 1 }, generation: active ? undefined : { increment: 1 }, disconnectedAt: active ? null : new Date(),
					lastInboundAt: active ? undefined : null, lastOutboundAt: active ? undefined : null } });
				if (!active) {
					const queued = await tx.telegramDelivery.findMany({ where: { channelId: channel.id, state: 'QUEUED' }, select: { messageId: true } });
					await tx.telegramDelivery.updateMany({ where: { channelId: channel.id, state: 'QUEUED' }, data: { state: 'CANCELLED', lastErrorCode: 'CONNECTION_REVOKED' } });
					await tx.telegramMessage.updateMany({ where: { id: { in: queued.map(item => item.messageId) } }, data: { deliveryStatus: 'CANCELLED' } });
				}
				await collaborationSignal(tx, channel.workspaceId);
			}
		}, { maxWait: 5_000, timeout: 20_000 });
	}

	private async botMessage(value: RecordValue) {
		const chat = record(value.chat);
		const from = record(value.from);
		const text = string(value.text);
		const match = text && /^\/start(?:@aerocrm_tech_bot)?\s+([A-Za-z0-9_-]{57})$/.exec(text);
		const userId = numericId(from?.id);
		if (!match || !userId || chat?.type !== 'private' || numericId(chat.id) !== userId) return;
		const id = this.telegram.parseStartToken(match[1]);
		if (!id) return;
		const session = await this.prisma.telegramConnectSession.findUnique({ where: { id } });
		if (!session || session.expiresAt.getTime() <= Date.now() || !['WAITING_TELEGRAM','OWNER_VERIFIED','CONNECTION_READY'].includes(session.state) || (session.telegramUserId && session.telegramUserId !== userId)) return;
		const connection = await this.prisma.telegramConnection.findFirst({ where: { telegramUserId: userId, enabled: true }, orderBy: { updatedAt: 'desc' } });
		const claimed = await this.prisma.telegramConnectSession.updateMany({ where: { id, version: session.version }, data: {
			telegramUserId: userId, ownerName: displayName(from), ownerUsername: string(from?.username),
			connectionId: connection?.connectionId ?? session.connectionId,
			state: session.state === 'WAITING_TELEGRAM' ? 'WAITING_TELEGRAM' : session.state,
			version: { increment: 1 }
		} });
		if (!claimed.count) return;
		// The button is deliberately sent after the durable owner-id capture. A
		// repeated /start can recover an ambiguous onboarding send.
		const branding = await this.prisma.crmWorkspaceBranding.findUnique({ where: { workspaceId: session.workspaceId } });
		const workspaceName = branding?.displayName || `пространству ${session.workspaceId.slice(0, 8)}`;
		try {
			await this.bot.sendBotMessage(userId, `Подключить Telegram Business аккаунт к «${workspaceName}» в aeroCRM? Переписку с покупателями смогут видеть сотрудники этого пространства.`, {
				inline_keyboard: [[{ text: 'Подтвердить подключение', callback_data: this.telegram.callbackData(id) }]]
			});
		} catch { /* user can repeat /start; never auto-resend an ambiguous send */ }
	}

	private async callback(value: RecordValue) {
		const id = string(value.data) && this.telegram.parseCallbackData(string(value.data)!);
		const from = record(value.from);
		const userId = numericId(from?.id);
		const chat = record(record(value.message)?.chat);
		if (!id || !userId || chat?.type !== 'private' || numericId(chat.id) !== userId) return;
		const session = await this.prisma.telegramConnectSession.findUnique({ where: { id } });
		if (!session || session.telegramUserId !== userId || session.expiresAt.getTime() <= Date.now() || !['WAITING_TELEGRAM','OWNER_VERIFIED','CONNECTION_READY'].includes(session.state)) return;
		const connection = session.connectionId ? await this.prisma.telegramConnection.findUnique({ where: { connectionId: session.connectionId } }) : null;
		await this.prisma.telegramConnectSession.updateMany({ where: { id, version: session.version }, data: {
			state: connection?.enabled && connection.canReply ? 'CONNECTION_READY' : 'OWNER_VERIFIED', version: { increment: 1 }
		} });
		if (string(value.id)) {
			try { await this.bot.answerCallback(string(value.id)!, 'Подтверждено. Завершите подключение в aeroCRM.'); }
			catch { /* acknowledgment is best effort */ }
		}
	}

	private content(value: RecordValue) {
		const kind = value.text !== undefined ? 'TEXT' : value.photo ? 'PHOTO' : value.video ? 'VIDEO' : value.document ? 'DOCUMENT' : value.voice ? 'VOICE' : 'OTHER';
		const caption = string(value.caption);
		const text = string(value.text) ?? (caption ? `${caption}\n[${kind}]` : `[${kind}]`);
		return { kind, text: text.slice(0, 10000) };
	}

	private async businessMessage(value: RecordValue, edited: boolean) {
		const connectionId = string(value.business_connection_id);
		const providerMessageId = numericId(value.message_id);
		const chat = record(value.chat);
		const providerChatId = numericId(chat?.id);
		const from = record(value.from);
		const authorUserId = numericId(from?.id);
		if (!connectionId || !providerMessageId || !providerChatId || !authorUserId || chat?.type !== 'private') return;
		const channel = await this.prisma.telegramChannel.findUnique({ where: { connectionId } });
		if (!channel || !['ACTIVE','DEGRADED'].includes(channel.status)) return;
		const providerAt = inboundDate(value.date);
		if (!providerAt) return;
		const origin = authorUserId === channel.ownerUserId ? 'BUSINESS_ACCOUNT' : 'CUSTOMER';
		// Messages emitted by this bot are already represented by the queued CRM
		// reply; Telegram's mirror must not create a second feed item.
		const content = this.content(value);
		await this.prisma.$transaction(async tx => {
			await tx.$queryRaw`SELECT id FROM crm_access.telegram_channels WHERE id=${channel.id}::uuid FOR UPDATE`;
			const freshChannel = await tx.telegramChannel.findUnique({ where: { id: channel.id } });
			if (!freshChannel || !['ACTIVE','DEGRADED'].includes(freshChannel.status) || freshChannel.connectionId !== connectionId) return;
			const existing = await tx.telegramMessage.findUnique({ where: { channelId_providerChatId_providerMessageId: { channelId: channel.id, providerChatId, providerMessageId } } });
			if (existing) {
				const editDate = inboundDate(value.edit_date);
				if (edited && editDate && !existing.deletedAt && (!existing.editedAt || editDate > existing.editedAt))
					await tx.telegramMessage.update({ where: { id: existing.id }, data: { text: content.text, editedAt: editDate } });
				return;
			}
			if (edited) throw new MissingTelegramMessageError();
			if (record(value.sender_business_bot)) return;
			const dialog = await tx.telegramDialog.upsert({
				where: { channelId_providerChatId: { channelId: channel.id, providerChatId } },
				create: { workspaceId: channel.workspaceId, channelId: channel.id, providerChatId, peerName: origin === 'CUSTOMER' ? displayName(from) : displayName(chat), lastInboundAt: origin === 'CUSTOMER' ? providerAt : null },
				update: { peerName: origin === 'CUSTOMER' ? displayName(from) : undefined }
			});
			if (origin === 'CUSTOMER' && (!dialog.lastInboundAt || providerAt > dialog.lastInboundAt))
				await tx.telegramDialog.update({ where: { id: dialog.id }, data: { lastInboundAt: providerAt } });
			if (origin === 'CUSTOMER' && providerAt >= channel.connectedAt && (!channel.lastInboundAt || providerAt > channel.lastInboundAt))
				await tx.telegramChannel.update({ where: { id: channel.id }, data: { lastInboundAt: providerAt } });
			const message = await tx.telegramMessage.create({ data: { workspaceId: channel.workspaceId, channelId: channel.id, dialogId: dialog.id,
				providerChatId, providerMessageId, direction: origin === 'CUSTOMER' ? 'INBOUND' : 'OUTBOUND', origin, contentKind: content.kind,
				authorUserId, authorName: displayName(from), text: content.text, providerAt } });
			const stream = await tx.workspaceMessengerStream.upsert({ where: { workspaceId: channel.workspaceId }, create: { workspaceId: channel.workspaceId, lastSequence: 1 }, update: { lastSequence: { increment: 1 } } });
			await tx.workspaceMessengerEntry.create({ data: { workspaceId: channel.workspaceId, sequence: stream.lastSequence,
				kind: origin === 'CUSTOMER' ? 'TELEGRAM_INBOUND' : 'TELEGRAM_OUTBOUND', telegramMessageId: message.id, createdAt: providerAt } });
			await collaborationSignal(tx, channel.workspaceId);
		});
	}

	private async deletedMessages(value: RecordValue) {
		const connectionId = string(value.business_connection_id);
		const chatId = numericId(record(value.chat)?.id);
		const ids = Array.isArray(value.message_ids) ? value.message_ids.map(numericId).filter((item): item is string => !!item) : [];
		if (!connectionId || !chatId || !ids.length) return;
		const channel = await this.prisma.telegramChannel.findUnique({ where: { connectionId } });
		if (!channel) return;
		const found = await this.prisma.telegramMessage.findMany({ where: { channelId: channel.id, providerChatId: chatId, providerMessageId: { in: ids } }, select: { providerMessageId: true } });
		const seen = new Set(found.map(item => item.providerMessageId));
		await this.prisma.telegramMessage.updateMany({ where: { channelId: channel.id, providerChatId: chatId, providerMessageId: { in: ids }, deletedAt: null }, data: { deletedAt: new Date(), text: '[Сообщение удалено]' } });
		if (ids.some(id => !seen.has(id))) throw new MissingTelegramMessageError();
	}

	private async processDeliveries() {
		for (const row of await this.deliveryCandidates('SENDING')) {
			try { await this.finish(row, 'UNKNOWN', 'STALE_SENDING'); }
			catch (error) { this.logger.warn(`Telegram stale delivery skipped: ${error instanceof Error ? error.name : 'unknown'}`); }
		}
		for (const row of await this.deliveryCandidates('QUEUED')) {
			try { await this.deliver(row); }
			catch (error) { this.logger.warn(`Telegram delivery skipped: ${error instanceof Error ? error.name : 'unknown'}`); }
		}
	}

	private async deliveryCandidates(state: 'SENDING' | 'QUEUED') {
		// Filter closed tenants before LIMIT, so their retained jobs cannot starve
		// another workspace. The database closure guard still fences races.
		const ids = await this.prisma.$queryRaw<{ commandId: string }[]>`
			SELECT d.command_id AS "commandId"
			FROM crm_access.telegram_deliveries d
			WHERE d.state=${state}
			  AND NOT EXISTS (
				SELECT 1 FROM crm_access.workspace_closure_fences f
				WHERE f.workspace_id=d.workspace_id AND f.fenced_at IS NOT NULL
			  )
			  AND (
				(${state}='SENDING' AND d.lease_until<now()) OR
				(${state}='QUEUED' AND d.next_run_at<=now() AND (d.lease_until IS NULL OR d.lease_until<now()))
			  )
			ORDER BY d.created_at,d.command_id
			LIMIT 20`;
		if (!ids.length) return [];
		const now = new Date();
		const rows = await this.prisma.telegramDelivery.findMany({ where: {
			commandId: { in: ids.map(item => item.commandId) }, state,
			...(state === 'SENDING'
				? { leaseUntil: { lt: now } }
				: { nextRunAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] })
		} });
		const byId = new Map(rows.map(row => [row.commandId, row]));
		return ids.map(item => byId.get(item.commandId)).filter((row): row is TelegramDelivery => !!row);
	}

	private async finish(row: TelegramDelivery, state: string, code: string | null, providerMessageId?: string) {
		await this.prisma.$transaction(async tx => {
			const changed = await tx.telegramDelivery.updateMany({ where: { commandId: row.commandId, state: row.state, leaseToken: row.leaseToken }, data: { state, lastErrorCode: code, leaseToken: null, leaseUntil: null } });
			if (!changed.count) return;
			await tx.telegramMessage.update({ where: { id: row.messageId }, data: { deliveryStatus: state, ...(providerMessageId ? { providerMessageId } : {}) } });
			if (state === 'SENT') await tx.telegramChannel.updateMany({ where: { id: row.channelId, generation: row.channelGeneration, status: 'ACTIVE' }, data: { lastOutboundAt: new Date() } });
			await collaborationSignal(tx, row.workspaceId);
		});
	}

	private async deliver(row: TelegramDelivery) {
		const token = randomUUID();
		const claimed = await this.prisma.telegramDelivery.updateMany({ where: { commandId: row.commandId, state: 'QUEUED', nextRunAt: { lte: new Date() }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 45_000), attempts: { increment: 1 } } });
		if (!claimed.count) return;
		const current = await this.prisma.telegramDelivery.findUniqueOrThrow({ where: { commandId: row.commandId } });
		try {
			const [channel, dialog, message] = await Promise.all([
				this.prisma.telegramChannel.findUnique({ where: { id: row.channelId } }),
				this.prisma.telegramDialog.findUnique({ where: { id: row.dialogId } }),
				this.prisma.telegramMessage.findUnique({ where: { id: row.messageId } })
			]);
			if (!channel || !dialog || !message || channel.workspaceId !== row.workspaceId || channel.generation !== row.channelGeneration || channel.status !== 'ACTIVE' || !channel.canReply || channel.connectionId !== row.connectionId || dialog.providerChatId !== row.providerChatId)
				{ await this.finish(current, 'CANCELLED', 'CHANNEL_CHANGED'); return; }
			const actor = await this.auth.assignmentSubject(row.workspaceId, row.actorSubject);
			if (actor.membershipId !== row.actorMembershipId || actor.state === 'READ_ONLY') { await this.finish(current, 'CANCELLED', 'ACTOR_CHANGED'); return; }
			if (!dialog.lastInboundAt || dialog.lastInboundAt.getTime() + 24 * 60 * 60_000 <= Date.now()) { await this.finish(current, 'FAILED', 'WINDOW_EXPIRED'); return; }
			const connection = await this.bot.getConnection(row.connectionId);
			if (!connection.is_enabled || String(connection.user.id) !== channel.ownerUserId || !(connection.rights?.can_reply ?? connection.can_reply ?? false)) { await this.finish(current, 'FAILED', 'CONNECTION_REVOKED'); return; }
			const admitted = await this.prisma.$transaction(async tx => {
				await workspaceLock(tx, row.workspaceId);
				await tx.$queryRaw`SELECT id FROM crm_access.telegram_channels WHERE id=${row.channelId}::uuid FOR UPDATE`;
				const fresh = await tx.telegramChannel.findUnique({ where: { id: row.channelId } });
				if (!fresh || fresh.generation !== row.channelGeneration || fresh.status !== 'ACTIVE' || fresh.connectionId !== row.connectionId) return false;
				const freshActor = await this.auth.assignmentSubject(row.workspaceId, row.actorSubject);
				if (freshActor.membershipId !== row.actorMembershipId || freshActor.state === 'READ_ONLY') return false;
				const freshDialog = await tx.telegramDialog.findUnique({ where: { id: row.dialogId } });
				if (!freshDialog?.lastInboundAt || freshDialog.lastInboundAt.getTime() + 24 * 60 * 60_000 <= Date.now()) return false;
				const changed = await tx.telegramDelivery.updateMany({ where: { commandId: row.commandId, leaseToken: token, state: 'QUEUED' }, data: { state: 'SENDING', dispatchAdmittedAt: new Date() } });
				if (changed.count) await tx.telegramMessage.update({ where: { id: row.messageId }, data: { deliveryStatus: 'SENDING' } });
				return changed.count === 1;
			});
			if (!admitted) { await this.finish(current, 'CANCELLED', 'CHANNEL_CHANGED'); return; }
			const accepted = await this.bot.sendMessage(row.connectionId, row.providerChatId, message.text);
			if (!Number.isSafeInteger(accepted.message_id) || !accepted.chat || String(accepted.chat.id) !== row.providerChatId)
				throw new TelegramTransportError('AMBIGUOUS', null, null);
			await this.finish({ ...current, state: 'SENDING' }, 'SENT', null, String(accepted.message_id));
		} catch (error) {
			const latest = await this.prisma.telegramDelivery.findUnique({ where: { commandId: row.commandId } });
			if (!latest || !['QUEUED','SENDING'].includes(latest.state) || latest.leaseToken !== token) return;
			if (latest.state === 'QUEUED') {
				if (latest.attempts >= 6 || (error instanceof TelegramTransportError && error.kind === 'REJECTED'))
					await this.finish(latest, 'FAILED', 'PRE_DISPATCH_ERROR');
				else await this.prisma.telegramDelivery.updateMany({ where: { commandId: row.commandId, state: 'QUEUED', leaseToken: token }, data: {
					leaseToken: null, leaseUntil: null, nextRunAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** latest.attempts)), lastErrorCode: 'PRE_DISPATCH_RETRY'
				} });
				return;
			}
			if (error instanceof TelegramTransportError && error.kind === 'REJECTED' && error.status === 429 && error.retryAfter && error.retryAfter <= 3600) {
				await this.prisma.$transaction(async tx => {
					const changed = await tx.telegramDelivery.updateMany({ where: { commandId: row.commandId, state: 'SENDING', leaseToken: token }, data: { state: 'QUEUED', leaseToken: null, leaseUntil: null, dispatchAdmittedAt: null, nextRunAt: new Date(Date.now() + error.retryAfter! * 1000), lastErrorCode: 'RATE_LIMITED' } });
					if (changed.count) await tx.telegramMessage.update({ where: { id: row.messageId }, data: { deliveryStatus: 'QUEUED' } });
				});
			} else if (error instanceof TelegramTransportError && error.kind === 'REJECTED' && error.status && error.status >= 400 && error.status < 500)
				await this.finish(latest, 'FAILED', `TELEGRAM_${error.status}`);
			else await this.finish(latest, 'UNKNOWN', 'AMBIGUOUS_SEND');
		}
	}
}
