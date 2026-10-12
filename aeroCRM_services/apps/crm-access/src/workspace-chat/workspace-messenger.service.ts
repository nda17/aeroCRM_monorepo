import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import type { Prisma, TelegramMessage, WorkspaceMessengerEntry } from '@prisma/crm-access-client';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { collaborationSignal } from '../directory/directory.util';
import { command } from '../team/team.util';
import { attachedDto } from './chat-attachments.service';
import { WorkspaceChatService } from './workspace-chat.service';
import type { ChatQueryDto } from './workspace-chat.dto';

type Actor = Awaited<ReturnType<CrmAuthorizationService['authorize']>> & {
	membershipId: string;
};

@Injectable()
export class WorkspaceMessengerService {
	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly auth: CrmAuthorizationService,
		private readonly chat: WorkspaceChatService
	) {}

	private async actor(token: string | undefined, workspaceId: string, tx?: Prisma.TransactionClient): Promise<Actor> {
		const actor = await this.auth.authorize(token, workspaceId, undefined, tx);
		const binding = await this.auth.assignmentSubject(workspaceId, actor.subject);
		return { ...actor, membershipId: binding.membershipId };
	}

	private async workspaceConversation(workspaceId: string, id: string, tx: Prisma.TransactionClient = this.prisma) {
		const row = await tx.crmChatConversation.findFirst({
			where: { id, workspaceId, kind: 'WORKSPACE' }
		});
		if (!row) throw new NotFoundException('Conversation was not found');
		return row;
	}

	private async cursor(actor: Actor) {
		return this.prisma.workspaceMessengerReadCursor.findUnique({
			where: {
				workspaceId_subject_membershipId: {
					workspaceId: actor.workspaceId,
					subject: actor.subject,
					membershipId: actor.membershipId
				}
			}
		});
	}

	private async feedItem(
		entry: WorkspaceMessengerEntry & {
			internalMessage: { id: string; conversationId: string; senderSubject: string; senderMembershipId: string; senderName: string; text: string } | null;
			telegramMessage: TelegramMessage | null;
		},
		channel?: { id: string; ownerName: string; status: string; canReply: boolean } | null,
		dialog?: { id: string; peerName: string; lastInboundAt: Date | null } | null,
		actorCanWrite = true
	) {
		const internal = entry.internalMessage;
		const external = entry.telegramMessage;
		const attachments = internal
			? await this.prisma.crmChatAttachment.findMany({
					where: { workspaceId: entry.workspaceId, messageId: internal.id, state: 'ATTACHED' }
				})
			: [];
		const replyUntil = dialog?.lastInboundAt
			? new Date(dialog.lastInboundAt.getTime() + 24 * 60 * 60 * 1000)
			: null;
		const isInbound = external?.direction === 'INBOUND' && external.origin === 'CUSTOMER';
		const canReply = !!(actorCanWrite && isInbound && channel?.status === 'ACTIVE' && channel.canReply && replyUntil && replyUntil.getTime() > Date.now() && !external.deletedAt);
		const reason = !actorCanWrite ? 'WORKSPACE_READ_ONLY' : !isInbound ? 'NOT_CUSTOMER_MESSAGE' : external?.deletedAt ? 'DELETED' : channel?.status !== 'ACTIVE' ? 'CHANNEL_UNAVAILABLE' : !channel.canReply ? 'REPLY_NOT_ALLOWED' : !replyUntil || replyUntil.getTime() <= Date.now() ? 'WINDOW_EXPIRED' : null;
		return {
			id: entry.id,
			sequence: entry.sequence,
			kind: entry.kind,
			text: external?.text ?? internal?.text ?? '',
			createdAt: entry.createdAt.toISOString(),
			editedAt: external?.editedAt?.toISOString() ?? null,
			deletedAt: external?.deletedAt?.toISOString() ?? null,
			author: internal
				? { kind: 'EMPLOYEE', displayName: internal.senderName, subject: internal.senderSubject, membershipId: internal.senderMembershipId }
				: external?.origin === 'CRM'
					? { kind: 'EMPLOYEE', displayName: external.authorName, subject: external.actorSubject, membershipId: external.actorMembershipId }
					: { kind: external?.origin === 'CUSTOMER' ? 'TELEGRAM_USER' : 'TELEGRAM_ACCOUNT', displayName: external?.authorName ?? 'Telegram', subject: null, membershipId: null },
			internal: internal ? { conversationId: internal.conversationId, messageId: internal.id, attachments: attachments.map(attachedDto) } : null,
			telegram: external && channel && dialog ? {
				messageId: external.id,
				channelId: channel.id,
				dialogId: dialog.id,
				accountName: channel.ownerName,
				peerName: dialog.peerName,
				contentKind: external.contentKind,
				mediaAvailable: external.mediaAvailable,
				deliveryStatus: external.deliveryStatus,
				canReply,
				replyUntil: replyUntil?.toISOString() ?? null,
				replyUnavailableReason: canReply ? null : reason
			} : null
		};
	}

	async conversations(token: string | undefined, query: ChatQueryDto) {
		const base = await this.chat.list(token, query);
		const actor = await this.actor(token, query.workspaceId);
		const stream = await this.prisma.workspaceMessengerStream.findUnique({ where: { workspaceId: actor.workspaceId } });
		const cursor = await this.cursor(actor);
		const through = cursor?.throughSequence ?? 0;
		const latest = await this.prisma.workspaceMessengerEntry.findFirst({
			where: { workspaceId: actor.workspaceId },
			include: { internalMessage: true, telegramMessage: true },
			orderBy: { sequence: 'desc' }
		});
		const unreadCount = await this.prisma.workspaceMessengerEntry.count({
			where: { workspaceId: actor.workspaceId, sequence: { gt: through }, OR: [
				{ telegramMessageId: { not: null }, telegramMessage: { origin: 'CUSTOMER', direction: 'INBOUND' } },
				{ internalMessageId: { not: null }, internalMessage: { senderSubject: { not: actor.subject } } }
			] }
		});
		return {
			...base,
			schemaVersion: 3,
			unreadCount,
			items: base.items.map(item => item.kind === 'WORKSPACE' ? {
				...item,
				lastSequence: stream?.lastSequence ?? 0,
				readThroughSequence: through,
				unreadCount,
				lastMessageAt: latest?.createdAt.toISOString() ?? null,
				lastMessage: latest ? {
					id: latest.telegramMessage?.id ?? latest.internalMessage?.id ?? latest.id,
					sequence: latest.sequence,
					text: latest.telegramMessage?.text ?? latest.internalMessage?.text ?? '',
					senderName: latest.telegramMessage?.authorName ?? latest.internalMessage?.senderName ?? 'Telegram',
					senderSubject: latest.telegramMessage?.actorSubject ?? latest.internalMessage?.senderSubject ?? null,
					createdAt: latest.createdAt.toISOString()
				} : null
			} : item)
		};
	}

	async messages(token: string | undefined, id: string, query: { workspaceId: string; beforeSequence?: number; limit: number }) {
		const actor = await this.actor(token, query.workspaceId);
		await this.workspaceConversation(actor.workspaceId, id);
		const [stream, cursor, rows] = await Promise.all([
			this.prisma.workspaceMessengerStream.findUnique({ where: { workspaceId: actor.workspaceId } }),
			this.cursor(actor),
			this.prisma.workspaceMessengerEntry.findMany({
				where: { workspaceId: actor.workspaceId, ...(query.beforeSequence ? { sequence: { lt: query.beforeSequence } } : {}) },
				include: { internalMessage: true, telegramMessage: true },
				orderBy: { sequence: 'desc' },
				take: query.limit + 1
			})
		]);
		const through = cursor?.throughSequence ?? 0;
		const hasMore = rows.length > query.limit;
		const slice = rows.slice(0, query.limit).reverse();
		const channels = await this.prisma.telegramChannel.findMany({ where: { id: { in: slice.flatMap(row => row.telegramMessage ? [row.telegramMessage.channelId] : []) }, workspaceId: actor.workspaceId } });
		const dialogs = await this.prisma.telegramDialog.findMany({ where: { id: { in: slice.flatMap(row => row.telegramMessage ? [row.telegramMessage.dialogId] : []) }, workspaceId: actor.workspaceId } });
		const unreadCount = await this.prisma.workspaceMessengerEntry.count({ where: { workspaceId: actor.workspaceId, sequence: { gt: through }, OR: [
			{ telegramMessage: { origin: 'CUSTOMER', direction: 'INBOUND' } },
			{ internalMessage: { senderSubject: { not: actor.subject } } }
		] } });
		return {
			schemaVersion: 3,
			workspaceId: actor.workspaceId,
			subject: actor.subject,
			conversationId: id,
			items: await Promise.all(slice.map(row => this.feedItem(row, channels.find(channel => channel.id === row.telegramMessage?.channelId), dialogs.find(dialog => dialog.id === row.telegramMessage?.dialogId), actor.state !== 'READ_ONLY'))),
			nextBeforeSequence: hasMore ? slice[0]?.sequence ?? null : null,
			lastSequence: stream?.lastSequence ?? 0,
			readThroughSequence: through,
			unreadCount,
			canSend: actor.state !== 'READ_ONLY'
		};
	}

	async read(token: string | undefined, id: string, dto: { workspaceId: string; commandId: string; throughSequence: number }) {
		const actor = await this.actor(token, dto.workspaceId);
		if (!Number.isInteger(dto.throughSequence) || dto.throughSequence < 0) throw new BadRequestException('Invalid read sequence');
		return command(this.prisma, actor, dto.commandId, 'messenger.read-v3', { ...dto, actorMembershipId: actor.membershipId }, async tx => {
			await this.workspaceConversation(actor.workspaceId, id, tx);
			const stream = await tx.workspaceMessengerStream.findUnique({ where: { workspaceId: actor.workspaceId } });
			if (dto.throughSequence > (stream?.lastSequence ?? 0)) throw new BadRequestException('Read sequence exceeds feed');
			const cursor = await tx.workspaceMessengerReadCursor.upsert({
				where: { workspaceId_subject_membershipId: { workspaceId: actor.workspaceId, subject: actor.subject, membershipId: actor.membershipId } },
				create: { workspaceId: actor.workspaceId, subject: actor.subject, membershipId: actor.membershipId, throughSequence: dto.throughSequence },
				update: { throughSequence: Math.max(dto.throughSequence, (await tx.workspaceMessengerReadCursor.findUnique({ where: { workspaceId_subject_membershipId: { workspaceId: actor.workspaceId, subject: actor.subject, membershipId: actor.membershipId } } }))?.throughSequence ?? 0) }
			});
			const lastInternal = await tx.workspaceMessengerEntry.findFirst({
				where: { workspaceId: actor.workspaceId, sequence: { lte: cursor.throughSequence }, internalMessageId: { not: null } },
				orderBy: { sequence: 'desc' }, include: { internalMessage: true }
			});
			if (lastInternal?.internalMessage) {
				const existing = await tx.crmChatParticipant.findUnique({ where: { conversationId_subject: { conversationId: id, subject: actor.subject } } });
				await tx.crmChatParticipant.upsert({
					where: { conversationId_subject: { conversationId: id, subject: actor.subject } },
					create: { workspaceId: actor.workspaceId, conversationId: id, subject: actor.subject, membershipId: actor.membershipId, readThroughSequence: lastInternal.internalMessage.sequence, readAt: new Date() },
					update: { membershipId: actor.membershipId, readThroughSequence: existing?.membershipId === actor.membershipId ? Math.max(existing.readThroughSequence, lastInternal.internalMessage.sequence) : lastInternal.internalMessage.sequence, readAt: new Date() }
				});
			}
			const unreadCount = await tx.workspaceMessengerEntry.count({ where: { workspaceId: actor.workspaceId, sequence: { gt: cursor.throughSequence }, OR: [
				{ telegramMessage: { origin: 'CUSTOMER', direction: 'INBOUND' } },
				{ internalMessage: { senderSubject: { not: actor.subject } } }
			] } });
			await collaborationSignal(tx, actor.workspaceId);
			return { schemaVersion: 3, workspaceId: actor.workspaceId, subject: actor.subject, conversationId: id, throughSequence: cursor.throughSequence, unreadCount };
		}, async tx => {
			const fresh = await this.actor(token, actor.workspaceId, tx);
			if (fresh.membershipId !== actor.membershipId) throw new ForbiddenException('Membership changed');
		});
	}
}
