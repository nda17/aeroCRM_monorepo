import {
	ChatAttachmentsService,
	attachedDto
} from './chat-attachments.service';
import type { SendMessageV2Dto } from './chat-messages-v2.dto';
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import type {
	CrmChatConversation,
	CrmChatMessage,
	CrmChatParticipant,
	Prisma
} from '@prisma/crm-access-client';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { command, semanticHash, type TeamAuthority } from '../team/team.util';
import { directoryName } from '../directory/directory.service';
import { collaborationSignal } from '../directory/directory.util';
import type {
	ChatQueryDto,
	MessageQueryDto,
	DirectChatDto,
	SendMessageDto,
	ReadChatDto,
	NotificationQueryDto
} from './workspace-chat.dto';

type Actor = TeamAuthority & { membershipId: string };
type Conversation = CrmChatConversation & {
	participants: CrmChatParticipant[];
};
const messageDto = (row: CrmChatMessage) => ({
	id: row.id,
	conversationId: row.conversationId,
	sequence: row.sequence,
	senderSubject: row.senderSubject,
	senderMembershipId: row.senderMembershipId,
	senderName: row.senderName,
	text: row.text,
	createdAt: row.createdAt.toISOString()
});

@Injectable()
export class WorkspaceChatService {
	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly auth: CrmAuthorizationService,
		private readonly attachments: ChatAttachmentsService
	) {}
	private async actor(
		token: string | undefined,
		workspaceId: string,
		tx?: Prisma.TransactionClient
	): Promise<Actor> {
		const actor = await this.auth.authorize(token, workspaceId, undefined, tx);
		const binding = await this.auth.assignmentSubject(
			workspaceId,
			actor.subject
		);
		return { ...actor, membershipId: binding.membershipId };
	}
	private async person(workspaceId: string, subject: string) {
		const row = await this.prisma.crmDirectoryEntry.findUnique({
			where: { workspaceId_subject: { workspaceId, subject } }
		});
		return directoryName(row, 'Сотрудник');
	}
	private async peer(actor: Actor, conversation: Conversation) {
		if (conversation.kind === 'WORKSPACE') return null;
		const participant = conversation.participants.find(
			row => row.subject !== actor.subject
		);
		if (!participant) throw new NotFoundException('Conversation was not found');
		let active = false;
		try {
			const current = await this.auth.assignmentSubject(
				actor.workspaceId,
				participant.subject
			);
			active = current.membershipId === participant.membershipId;
		} catch (error) {
			if (!(error instanceof ForbiddenException)) throw error;
		}
		return {
			subject: participant.subject,
			membershipId: participant.membershipId,
			displayName: await this.person(actor.workspaceId, participant.subject),
			active
		};
	}
	private bound(actor: Actor, row: Conversation) {
		return (
			row.kind === 'WORKSPACE' ||
			row.participants.some(
				item =>
					item.subject === actor.subject &&
					item.membershipId === actor.membershipId
			)
		);
	}
	private async current(
		tx: Prisma.TransactionClient,
		actor: Actor,
		id: string
	) {
		const row = await tx.crmChatConversation.findFirst({
			where: { id, workspaceId: actor.workspaceId },
			include: { participants: true }
		});
		if (!row || !this.bound(actor, row))
			throw new NotFoundException('Conversation was not found');
		return row;
	}
	private async dto(actor: Actor, row: Conversation) {
		const peer = await this.peer(actor, row);
		const participant = row.participants.find(
			item =>
				item.subject === actor.subject &&
				item.membershipId === actor.membershipId
		);
		const through = participant?.readThroughSequence ?? 0;
		const [unreadCount, last] = await Promise.all([
			this.prisma.crmChatMessage.count({
				where: {
					workspaceId: actor.workspaceId,
					conversationId: row.id,
					sequence: { gt: through },
					senderSubject: { not: actor.subject }
				}
			}),
			this.prisma.crmChatMessage.findFirst({
				where: { workspaceId: actor.workspaceId, conversationId: row.id },
				orderBy: { sequence: 'desc' }
			})
		]);
		return {
			id: row.id,
			kind: row.kind,
			title: peer?.displayName ?? 'Общий чат',
			peer,
			lastSequence: row.lastSequence,
			readThroughSequence: through,
			peerReadThroughSequence: peer
				? (row.participants.find(item => item.subject === peer.subject)
						?.readThroughSequence ?? 0)
				: null,
			unreadCount,
			lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
			lastMessage: last
				? {
						id: last.id,
						sequence: last.sequence,
						senderSubject: last.senderSubject,
						text: last.text,
						createdAt: last.createdAt.toISOString()
					}
				: null,
			canSend: actor.state !== 'READ_ONLY' && (!peer || peer.active)
		};
	}
	private async visible(actor: Actor) {
		return this.prisma.crmChatConversation.findMany({
			where: {
				workspaceId: actor.workspaceId,
				OR: [
					{ kind: 'WORKSPACE' },
					{
						participants: {
							some: {
								subject: actor.subject,
								membershipId: actor.membershipId
							}
						}
					}
				]
			},
			include: { participants: true },
			orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }]
		});
	}
	async list(token: string | undefined, query: ChatQueryDto) {
		const actor = await this.actor(token, query.workspaceId);
		const visibility: Prisma.CrmChatConversationWhereInput = {
			workspaceId: actor.workspaceId,
			OR: [
				{ kind: 'WORKSPACE' },
				{
					participants: {
						some: {
							subject: actor.subject,
							membershipId: actor.membershipId
						}
					}
				}
			]
		};
		let where = visibility;
		if (query.q) {
			const people = await this.prisma.crmDirectoryEntry.findMany({
				where: {
					workspaceId: actor.workspaceId,
					OR: ['firstName', 'lastName', 'middleName', 'email'].map(field => ({
						[field]: { contains: query.q, mode: 'insensitive' }
					}))
				},
				select: { subject: true }
			});
			const subjects = people.flatMap(person =>
				person.subject ? [person.subject] : []
			);
			where = {
				AND: [
					visibility,
					{
						OR: [
							...('общий чат'.includes(query.q.toLowerCase())
								? [{ kind: 'WORKSPACE' }]
								: []),
							{
								kind: 'DIRECT',
								participants: {
									some: { subject: { in: subjects, not: actor.subject } }
								}
							}
						]
					}
				]
			};
		}
		const [total, rows, counts] = await Promise.all([
			this.prisma.crmChatConversation.count({ where }),
			this.prisma.crmChatConversation.findMany({
				where,
				include: { participants: true },
				orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
				skip: (query.page - 1) * query.pageSize,
				take: query.pageSize
			}),
			this.prisma.$queryRaw<
				{ count: bigint }[]
			>`SELECT count(*) AS count FROM crm_access.crm_chat_messages m
        JOIN crm_access.crm_chat_conversations c ON c.id=m.conversation_id AND c.workspace_id=m.workspace_id
        LEFT JOIN crm_access.crm_chat_participants p ON p.conversation_id=c.id AND p.workspace_id=c.workspace_id
          AND p.subject=${actor.subject} AND p.membership_id=${actor.membershipId}::uuid
        WHERE c.workspace_id=${actor.workspaceId}::uuid AND (c.kind='WORKSPACE' OR p.subject IS NOT NULL)
          AND m.sender_subject<>${actor.subject} AND m.sequence>COALESCE(p.read_through_sequence,0)`
		]);
		return {
			schemaVersion: 1,
			workspaceId: actor.workspaceId,
			subject: actor.subject,
			page: query.page,
			pageSize: query.pageSize,
			total,
			unreadCount: Number(counts[0]?.count ?? 0),
			items: await Promise.all(rows.map(row => this.dto(actor, row)))
		};
	}
	async direct(token: string | undefined, dto: DirectChatDto) {
		const actor = await this.actor(token, dto.workspaceId);
		if (actor.state === 'READ_ONLY')
			throw new ForbiddenException('Chat is read-only');
		if (dto.recipientSubject === actor.subject)
			throw new BadRequestException('Choose another participant');
		const recipient = await this.auth.assignmentSubject(
			actor.workspaceId,
			dto.recipientSubject
		);
		const pairKey = semanticHash(
			[
				{ subject: actor.subject, membershipId: actor.membershipId },
				{
					subject: recipient.subject,
					membershipId: recipient.membershipId
				}
			].sort((a, b) => a.subject.localeCompare(b.subject))
		);
		const result = await command(
			this.prisma,
			actor,
			dto.commandId,
			'chat.direct',
			{
				...dto,
				actorMembershipId: actor.membershipId,
				recipientMembershipId: recipient.membershipId
			},
			async tx => {
				const fresh = await this.auth.assignmentSubject(
					actor.workspaceId,
					recipient.subject
				);
				if (fresh.membershipId !== recipient.membershipId)
					throw new ForbiddenException('Recipient membership changed');
				if (fresh.role !== 'OWNER') {
					const local = await tx.crmWorkspaceMember.findUnique({
						where: {
							workspaceId_subject: {
								workspaceId: actor.workspaceId,
								subject: recipient.subject
							}
						}
					});
					if (
						!local ||
						local.disabledAt ||
						local.membershipId !== recipient.membershipId
					)
						throw new ForbiddenException('Recipient is unavailable');
				}
				const row = await tx.crmChatConversation.upsert({
					where: {
						workspaceId_pairKey: {
							workspaceId: actor.workspaceId,
							pairKey
						}
					},
					create: {
						workspaceId: actor.workspaceId,
						pairKey,
						kind: 'DIRECT',
						participants: {
							create: [
								{
									subject: actor.subject,
									membershipId: actor.membershipId
								},
								{
									subject: recipient.subject,
									membershipId: recipient.membershipId
								}
							]
						}
					},
					update: {},
					include: { participants: true }
				});
				await collaborationSignal(tx, actor.workspaceId);
				return {
					schemaVersion: 1,
					workspaceId: actor.workspaceId,
					subject: actor.subject,
					conversation: await this.dto(actor, row)
				};
			},
			async tx => {
				const fresh = await this.actor(token, dto.workspaceId, tx);
				if (
					fresh.membershipId !== actor.membershipId ||
					fresh.state === 'READ_ONLY'
				)
					throw new ForbiddenException();
			}
		);
		return result;
	}
	async messages(
		token: string | undefined,
		id: string,
		query: MessageQueryDto
	) {
		const actor = await this.actor(token, query.workspaceId);
		const row = await this.current(this.prisma, actor, id);
		const items = await this.prisma.crmChatMessage.findMany({
			where: {
				workspaceId: actor.workspaceId,
				conversationId: id,
				...(query.beforeSequence !== undefined
					? { sequence: { lt: query.beforeSequence } }
					: {})
			},
			orderBy: { sequence: 'desc' },
			take: query.limit + 1
		});
		const hasMore = items.length > query.limit;
		const slice = items.slice(0, query.limit).reverse();
		return {
			schemaVersion: 1,
			workspaceId: actor.workspaceId,
			subject: actor.subject,
			conversation: await this.dto(actor, row),
			items: slice.map(messageDto),
			nextBeforeSequence: hasMore ? (slice[0]?.sequence ?? null) : null
		};
	}
	async messagesV2(
		token: string | undefined,
		id: string,
		query: MessageQueryDto
	) {
		const result = await this.messages(token, id, query);
		const rows = await this.prisma.crmChatAttachment.findMany({
			where: {
				workspaceId: query.workspaceId,
				conversationId: id,
				messageId: { in: result.items.map(item => item.id) },
				state: 'ATTACHED'
			}
		});
		await this.attachments.conversation(
			await this.attachments.actor(token, query.workspaceId),
			id
		);
		return {
			...result,
			schemaVersion: 2,
			items: result.items.map(item => ({
				...item,
				attachments: rows
					.filter(row => row.messageId === item.id)
					.map(attachedDto)
			}))
		};
	}

	async sendLookup(
		token: string | undefined,
		id: string,
		workspaceId: string,
		commandId: string
	) {
		const actor = await this.actor(token, workspaceId);
		await this.current(this.prisma, actor, id);
		const receipt = await this.prisma.crmTeamCommandReceipt.findUnique({
			where: { commandId }
		});
		if (!receipt)
			return { schemaVersion: 1, workspaceId, status: 'ABSENT', result: null };
		const result = receipt.result as unknown as {
			schemaVersion: number;
			workspaceId: string;
			subject: string;
			item: { conversationId: string; senderMembershipId: string };
		};
		if (
			receipt.workspaceId !== workspaceId ||
			receipt.actorSubject !== actor.subject ||
			receipt.commandType !== 'chat.send-v2' ||
			result.item?.conversationId !== id ||
			result.item?.senderMembershipId !== actor.membershipId
		)
			throw new ForbiddenException();
		return { schemaVersion: 1, workspaceId, status: 'COMMITTED', result };
	}

	private async participant(
		tx: Prisma.TransactionClient,
		actor: Actor,
		row: Conversation
	) {
		if (row.kind === 'DIRECT')
			return row.participants.find(item => item.subject === actor.subject)!;
		const prior = row.participants.find(item => item.subject === actor.subject);
		return tx.crmChatParticipant.upsert({
			where: {
				conversationId_subject: {
					conversationId: row.id,
					subject: actor.subject
				}
			},
			create: {
				workspaceId: actor.workspaceId,
				conversationId: row.id,
				subject: actor.subject,
				membershipId: actor.membershipId
			},
			update:
				prior?.membershipId === actor.membershipId
					? {}
					: {
							membershipId: actor.membershipId,
							readThroughSequence: 0,
							readAt: null
						}
		});
	}
	async send(
		token: string | undefined,
		id: string,
		dto: SendMessageDto | SendMessageV2Dto
	) {
		const actor = await this.actor(token, dto.workspaceId);
		if (actor.state === 'READ_ONLY')
			throw new ForbiddenException('Chat is read-only');
		const attachmentIds = dto.schemaVersion === 2 ? dto.attachmentIds : [];
		const text = dto.text?.trim() || (attachmentIds.length ? 'Вложения' : '');
		if (!text || text.length > 10000)
			throw new BadRequestException('Invalid message text');
		return command(
			this.prisma,
			actor,
			dto.commandId,
			dto.schemaVersion === 2 ? 'chat.send-v2' : 'chat.send',
			{ ...dto, id, text, actorMembershipId: actor.membershipId },
			async tx => {
				const row = await this.current(tx, actor, id);
				const peer = await this.peer(actor, row);
				if (peer && !peer.active)
					throw new ForbiddenException('Recipient is unavailable');
				if (peer) {
					const local = await tx.crmWorkspaceMember.findUnique({
						where: {
							workspaceId_subject: {
								workspaceId: actor.workspaceId,
								subject: peer.subject
							}
						}
					});
					const ws = await tx.crmWorkspaceAccess.findUniqueOrThrow({
						where: { workspaceId: actor.workspaceId }
					});
					if (
						ws.activatedBySubject !== peer.subject &&
						(!local ||
							local.disabledAt ||
							local.membershipId !== peer.membershipId)
					)
						throw new ForbiddenException();
				}
				await this.participant(tx, actor, row);
				const updated = await tx.crmChatConversation.update({
					where: { id },
					data: {
						lastSequence: { increment: 1 },
						lastMessageAt: new Date()
					}
				});
				const message = await tx.crmChatMessage.create({
					data: {
						workspaceId: actor.workspaceId,
						conversationId: id,
						sequence: updated.lastSequence,
						senderSubject: actor.subject,
						senderMembershipId: actor.membershipId,
						senderName: await this.person(actor.workspaceId, actor.subject),
						text
					}
				});
				const attachments = attachmentIds.length
					? await this.attachments.bind(
							tx,
							actor,
							id,
							attachmentIds,
							message.id
						)
					: [];
				await collaborationSignal(tx, actor.workspaceId);
				return {
					schemaVersion: dto.schemaVersion,
					workspaceId: actor.workspaceId,
					subject: actor.subject,
					item:
						dto.schemaVersion === 2
							? { ...messageDto(message), attachments }
							: messageDto(message)
				};
			},
			async tx => {
				const fresh = await this.actor(token, dto.workspaceId, tx);
				if (
					fresh.membershipId !== actor.membershipId ||
					fresh.state === 'READ_ONLY'
				)
					throw new ForbiddenException();
				if (dto.schemaVersion === 2)
					await this.attachments.conversation(fresh, id, tx, true);
			}
		);
	}
	async read(token: string | undefined, id: string, dto: ReadChatDto) {
		const actor = await this.actor(token, dto.workspaceId);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'chat.read',
			{ ...dto, id, actorMembershipId: actor.membershipId },
			async tx => {
				const row = await this.current(tx, actor, id);
				if (dto.throughSequence > row.lastSequence)
					throw new BadRequestException('Read sequence exceeds conversation');
				const prior = await this.participant(tx, actor, row);
				const through = Math.max(
					prior.readThroughSequence,
					dto.throughSequence
				);
				await tx.crmChatParticipant.update({
					where: {
						conversationId_subject: {
							conversationId: id,
							subject: actor.subject
						}
					},
					data: { readThroughSequence: through, readAt: new Date() }
				});
				const unreadCount = await tx.crmChatMessage.count({
					where: {
						workspaceId: actor.workspaceId,
						conversationId: id,
						sequence: { gt: through },
						senderSubject: { not: actor.subject }
					}
				});
				await collaborationSignal(tx, actor.workspaceId);
				return {
					schemaVersion: 1,
					workspaceId: actor.workspaceId,
					subject: actor.subject,
					conversationId: id,
					throughSequence: through,
					unreadCount
				};
			},
			async tx => {
				const fresh = await this.actor(token, dto.workspaceId, tx);
				if (fresh.membershipId !== actor.membershipId)
					throw new ForbiddenException();
			}
		);
	}
	async notifications(token: string | undefined, query: NotificationQueryDto) {
		const actor = await this.actor(token, query.workspaceId);
		const conversations = await this.visible(actor);
		const info = new Map(
			conversations.map(row => [
				row.id,
				{
					row,
					through:
						row.participants.find(
							p =>
								p.subject === actor.subject &&
								p.membershipId === actor.membershipId
						)?.readThroughSequence ?? 0
				}
			])
		);
		const conditions = conversations.map(row => ({
			conversationId: row.id,
			...(query.unreadOnly
				? { sequence: { gt: info.get(row.id)!.through } }
				: {})
		}));
		const where: Prisma.CrmChatMessageWhereInput = {
			workspaceId: actor.workspaceId,
			senderSubject: { not: actor.subject },
			OR: conditions
		};
		const unreadWhere: Prisma.CrmChatMessageWhereInput = {
			workspaceId: actor.workspaceId,
			senderSubject: { not: actor.subject },
			OR: conversations.map(row => ({
				conversationId: row.id,
				sequence: { gt: info.get(row.id)!.through }
			}))
		};
		const [total, unreadCount, rows] = await Promise.all([
			this.prisma.crmChatMessage.count({ where }),
			this.prisma.crmChatMessage.count({ where: unreadWhere }),
			this.prisma.crmChatMessage.findMany({
				where,
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				skip: (query.page - 1) * query.pageSize,
				take: query.pageSize
			})
		]);
		return {
			schemaVersion: 1,
			workspaceId: actor.workspaceId,
			subject: actor.subject,
			page: query.page,
			pageSize: query.pageSize,
			total,
			unreadCount,
			items: await Promise.all(
				rows.map(async row => {
					const item = info.get(row.conversationId)!;
					const peer = await this.peer(actor, item.row);
					const participant = item.row.participants.find(
						p =>
							p.subject === actor.subject &&
							p.membershipId === actor.membershipId
					);
					return {
						id: row.id,
						messageId: row.id,
						conversationId: row.conversationId,
						sequence: row.sequence,
						title: peer?.displayName ?? 'Общий чат',
						text: row.text,
						senderName: row.senderName,
						createdAt: row.createdAt.toISOString(),
						readAt:
							row.sequence <= item.through
								? (participant?.readAt?.toISOString() ?? null)
								: null
					};
				})
			)
		};
	}
}
