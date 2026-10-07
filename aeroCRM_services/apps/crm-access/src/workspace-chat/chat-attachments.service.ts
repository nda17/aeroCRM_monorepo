import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	OnModuleDestroy,
	OnModuleInit,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma, type CrmChatAttachment } from '@prisma/crm-access-client';
import { createHash, randomUUID } from 'node:crypto';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import {
	command,
	serializable,
	semanticHash,
	workspaceLock,
	type TeamAuthority
} from '../team/team.util';
import {
	ChatObjects,
	safeChatFilename,
	validateChatBytes
} from './chat.objects';

type Actor = TeamAuthority & { membershipId: string };
export const attachmentDto = (row: CrmChatAttachment) => ({
	id: row.id,
	conversationId: row.conversationId,
	fileName: row.fileName,
	mediaType: row.detectedMime,
	byteSize: row.byteSize,
	sha256: row.sha256,
	state: row.state,
	expiresAt: row.expiresAt.toISOString()
});
export const attachedDto = (row: CrmChatAttachment) => ({
	id: row.id,
	fileName: row.fileName,
	mediaType: row.detectedMime,
	byteSize: row.byteSize,
	sha256: row.sha256
});
@Injectable()
export class ChatAttachmentsService implements OnModuleInit, OnModuleDestroy {
	private timer?: ReturnType<typeof setInterval>;
	private running = false;
	private cursor?: string;
	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly auth: CrmAuthorizationService,
		private readonly objects: ChatObjects
	) {}
	onModuleInit() {
		if (
			(process.env.CRM_ACCESS_PROCESS_ROLE || 'api') !== 'api' ||
			!this.objects.available
		)
			return;
		this.timer = setInterval(() => {
			void this.sweep().catch(() => undefined);
		}, 300000);
		this.timer.unref();
	}
	onModuleDestroy() {
		if (this.timer) clearInterval(this.timer);
	}
	async actor(
		token: string | undefined,
		workspaceId: string,
		tx?: Prisma.TransactionClient,
		write = false
	): Promise<Actor> {
		const actor = await this.auth.authorize(token, workspaceId, undefined, tx);
		const binding = await this.auth.assignmentSubject(
			workspaceId,
			actor.subject
		);
		if (write && !['ACTIVE', 'GRACE'].includes(actor.state))
			throw new ForbiddenException('Chat is read-only');
		return { ...actor, membershipId: binding.membershipId };
	}
	async conversation(
		actor: Actor,
		id: string,
		tx: Prisma.TransactionClient = this.prisma,
		write = false
	) {
		const row = await tx.crmChatConversation.findFirst({
			where: { id, workspaceId: actor.workspaceId },
			include: { participants: true }
		});
		if (
			!row ||
			(row.kind === 'DIRECT' &&
				!row.participants.some(
					p =>
						p.subject === actor.subject && p.membershipId === actor.membershipId
				))
		)
			throw new NotFoundException('Conversation was not found');
		if (write && row.kind === 'DIRECT') {
			for (const p of row.participants) {
				const current = await this.auth.assignmentSubject(
					actor.workspaceId,
					p.subject
				);
				if (current.membershipId !== p.membershipId)
					throw new ForbiddenException('Recipient membership changed');
			}
		}
		return row;
	}
	async preflight(token: string | undefined, workspaceId: string, id: string) {
		if (!this.objects.available)
			throw new ServiceUnavailableException(
				'Chat attachments are not configured'
			);
		const actor = await this.actor(token, workspaceId, undefined, true);
		await this.conversation(actor, id, this.prisma, true);
		return actor;
	}
	async capabilities(token: string | undefined, workspaceId: string) {
		await this.actor(token, workspaceId);
		return {
			schemaVersion: 1,
			workspaceId,
			enabled: this.objects.available,
			maxFileBytes: 5242880,
			maxFiles: 10,
			maxMessageBytes: 20971520,
			allowedExtensions: [
				'png',
				'jpg',
				'jpeg',
				'webp',
				'pdf',
				'txt',
				'csv',
				'docx',
				'xlsx'
			]
		};
	}
	private envelope(workspaceId: string, row: CrmChatAttachment | null) {
		return {
			schemaVersion: 1,
			workspaceId,
			attachment: row ? attachmentDto(row) : null
		};
	}
	private async fresh(
		token: string | undefined,
		actor: Actor,
		tx: Prisma.TransactionClient,
		write = true
	) {
		const fresh = await this.actor(token, actor.workspaceId, tx, write);
		if (
			fresh.membershipId !== actor.membershipId ||
			fresh.subject !== actor.subject
		)
			throw new ForbiddenException('Membership changed');
		return fresh;
	}
	private async retryReservation<T>(action: () => Promise<T>): Promise<T> {
		for (let attempt = 0; ; attempt++) {
			try {
				return await action();
			} catch (error) {
				if (
					attempt >= 2 ||
					!(error instanceof Prisma.PrismaClientKnownRequestError) ||
					!(
						error.code === 'P2034' ||
						(error.code === 'P2010' &&
							['40001', '40P01'].includes(String(error.meta?.code)))
					)
				)
					throw error;
				await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
			}
		}
	}

	async upload(
		token: string | undefined,
		id: string,
		dto: { workspaceId: string; commandId: string },
		file: { buffer: Buffer; originalname: string; mimetype: string }
	) {
		const actor = await this.preflight(token, dto.workspaceId, id);
		if (!file?.buffer) throw new BadRequestException('File is required');
		const fileName = safeChatFilename(file.originalname);
		let mediaType: string;
		try {
			mediaType = await validateChatBytes(file.buffer, fileName, file.mimetype);
		} catch {
			throw new BadRequestException('File content or type rejected');
		}
		const sha256 = createHash('sha256').update(file.buffer).digest('hex');
		const body = {
			id,
			fileName,
			mediaType,
			declaredMime: file.mimetype,
			byteSize: file.buffer.length,
			sha256,
			membershipId: actor.membershipId
		};
		const requestHash = semanticHash(body);
		const leaseOwner = randomUUID();
		const reserved = await this.retryReservation(() =>
			command(
				this.prisma,
				actor,
				dto.commandId,
				'chat.upload',
				body,
				async tx => {
					await this.conversation(actor, id, tx, true);
					const retained = await tx.crmChatAttachment.aggregate({
						where: {
							workspaceId: actor.workspaceId,
							state: { not: 'DELETED' }
						},
						_sum: { byteSize: true }
					});
					const pending = await tx.crmChatAttachment.aggregate({
						where: {
							workspaceId: actor.workspaceId,
							uploadActorMembershipId: actor.membershipId,
							state: { in: ['UPLOADING', 'READY', 'DELETING'] }
						},
						_sum: { byteSize: true },
						_count: true
					});
					if (
						(retained._sum.byteSize || 0) + file.buffer.length > 1073741824 ||
						(pending._sum.byteSize || 0) + file.buffer.length > 52428800 ||
						pending._count >= 20
					)
						throw new ConflictException('Attachment quota exceeded');
					const attachmentId = randomUUID();
					const row = await tx.crmChatAttachment.create({
						data: {
							id: attachmentId,
							workspaceId: actor.workspaceId,
							conversationId: id,
							uploadActorMembershipId: actor.membershipId,
							uploadCommandId: dto.commandId,
							subject: actor.subject,
							requestHash,
							fileName,
							declaredMime: file.mimetype,
							detectedMime: mediaType,
							byteSize: file.buffer.length,
							sha256,
							privateObjectKey: this.objects.key(
								actor.workspaceId,
								id,
								attachmentId
							),
							state: 'UPLOADING',
							expiresAt: new Date(Date.now() + 86400000)
						}
					});
					return { attachmentId: row.id };
				},
				async tx => {
					await this.fresh(token, actor, tx);
					await this.conversation(actor, id, tx, true);
				}
			)
		);
		const leased = await serializable(this.prisma, async tx => {
			await workspaceLock(tx, actor.workspaceId);
			await this.fresh(token, actor, tx);
			await this.conversation(actor, id, tx, true);
			const row = await tx.crmChatAttachment.findUniqueOrThrow({
				where: { id: reserved.attachmentId }
			});
			if (
				row.requestHash !== requestHash ||
				row.uploadActorMembershipId !== actor.membershipId
			)
				throw new ConflictException('Attachment command conflict');
			if (row.state !== 'UPLOADING') return row;
			if (
				row.expiresAt.getTime() <= Date.now() ||
				(row.leaseUntil && row.leaseUntil.getTime() > Date.now())
			)
				throw new ConflictException(
					'Attachment upload is in progress or expired'
				);
			return tx.crmChatAttachment.update({
				where: { id: row.id, version: row.version },
				data: {
					version: { increment: 1 },
					leaseOwner,
					leaseUntil: new Date(Date.now() + 120000)
				}
			});
		});
		if (leased.state !== 'UPLOADING')
			return this.envelope(actor.workspaceId, leased);
		this.objects.assertKey(leased.privateObjectKey, actor.workspaceId, id);
		await this.objects.put(leased.privateObjectKey, file.buffer);
		const ready = await serializable(this.prisma, async tx => {
			await workspaceLock(tx, actor.workspaceId);
			await this.fresh(token, actor, tx);
			await this.conversation(actor, id, tx, true);
			const changed = await tx.crmChatAttachment.updateMany({
				where: {
					id: leased.id,
					version: leased.version,
					state: 'UPLOADING',
					leaseOwner,
					leaseUntil: { gt: new Date() },
					expiresAt: { gt: new Date() }
				},
				data: {
					state: 'READY',
					version: { increment: 1 },
					leaseOwner: null,
					leaseUntil: null
				}
			});
			if (changed.count !== 1)
				throw new ConflictException('Upload lease expired');
			return tx.crmChatAttachment.findUniqueOrThrow({
				where: { id: leased.id }
			});
		});
		return this.envelope(actor.workspaceId, ready);
	}
	async lookup(
		token: string | undefined,
		workspaceId: string,
		commandId: string
	) {
		const actor = await this.actor(token, workspaceId);
		const row = await this.prisma.crmChatAttachment.findFirst({
			where: {
				workspaceId,
				uploadCommandId: commandId,
				subject: actor.subject,
				uploadActorMembershipId: actor.membershipId
			}
		});
		if (row) await this.conversation(actor, row.conversationId);
		return this.envelope(workspaceId, row);
	}
	async discard(
		token: string | undefined,
		id: string,
		dto: { workspaceId: string; commandId: string }
	) {
		const actor = await this.actor(token, dto.workspaceId, undefined, true);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'chat.discard',
			{ id, ...dto, membershipId: actor.membershipId },
			async tx => {
				const row = await tx.crmChatAttachment.findFirst({
					where: {
						id,
						workspaceId: actor.workspaceId,
						subject: actor.subject,
						uploadActorMembershipId: actor.membershipId
					}
				});
				if (!row) throw new NotFoundException();
				await this.conversation(actor, row.conversationId, tx);
				if (row.state === 'ATTACHED')
					throw new ConflictException('Attachment already sent');
				if (['READY', 'UPLOADING'].includes(row.state))
					await tx.crmChatAttachment.update({
						where: { id, version: row.version },
						data: {
							state: 'DELETING',
							version: { increment: 1 },
							leaseOwner: row.state === 'UPLOADING' ? row.leaseOwner : null,
							leaseUntil: row.state === 'UPLOADING' ? row.leaseUntil : null
						}
					});
				return {
					schemaVersion: 1,
					workspaceId: actor.workspaceId,
					attachment: {
						...attachmentDto(row),
						state: row.state === 'DELETED' ? 'DELETED' : 'DELETING'
					}
				};
			},
			async tx => {
				await this.fresh(token, actor, tx);
				const row = await tx.crmChatAttachment.findFirst({
					where: {
						id,
						workspaceId: actor.workspaceId,
						subject: actor.subject,
						uploadActorMembershipId: actor.membershipId
					}
				});
				if (!row) throw new NotFoundException();
				await this.conversation(actor, row.conversationId, tx);
			}
		);
	}
	async content(token: string | undefined, workspaceId: string, id: string) {
		const actor = await this.actor(token, workspaceId);
		const row = await this.prisma.crmChatAttachment.findFirst({
			where: { id, workspaceId, state: 'ATTACHED' }
		});
		if (!row) throw new NotFoundException();
		await this.conversation(actor, row.conversationId);
		this.objects.assertKey(
			row.privateObjectKey,
			workspaceId,
			row.conversationId
		);
		const bytes = await this.objects.get(row.privateObjectKey, row.byteSize);
		if (
			bytes.length !== row.byteSize ||
			createHash('sha256').update(bytes).digest('hex') !== row.sha256
		)
			throw new ServiceUnavailableException(
				'Attachment integrity check failed'
			);
		const fresh = await this.actor(token, workspaceId);
		await this.conversation(fresh, row.conversationId);
		return { row, bytes };
	}
	async bind(
		tx: Prisma.TransactionClient,
		actor: Actor,
		conversationId: string,
		ids: string[],
		messageId: string
	) {
		if (!ids.length) return [];
		await tx.$queryRaw`SELECT id FROM crm_access.crm_chat_attachments WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
		const rows = await tx.crmChatAttachment.findMany({
			where: {
				id: { in: ids },
				workspaceId: actor.workspaceId,
				conversationId,
				subject: actor.subject,
				uploadActorMembershipId: actor.membershipId,
				state: 'READY',
				expiresAt: { gt: new Date() }
			}
		});
		if (
			rows.length !== ids.length ||
			rows.reduce((sum, r) => sum + r.byteSize, 0) > 20971520
		)
			throw new ConflictException('Attachments are unavailable');
		for (const row of rows)
			await tx.crmChatAttachment.update({
				where: { id: row.id, version: row.version },
				data: { messageId, state: 'ATTACHED', version: { increment: 1 } }
			});
		return rows.map(attachedDto);
	}
	async sweep() {
		if (this.running || !this.objects.available) return;
		this.running = true;
		try {
			const rows = await this.prisma.$queryRaw<
				{ id: string; workspaceId: string }[]
			>`
 SELECT a.id, a.workspace_id AS "workspaceId"
 FROM crm_access.crm_chat_attachments a
 WHERE ((a.state IN ('UPLOADING','READY') AND a.expires_at < now()) OR a.state='DELETING')
   AND (a.lease_until IS NULL OR a.lease_until <= now())
   AND NOT EXISTS (SELECT 1 FROM crm_access.workspace_closure_fences f WHERE f.workspace_id=a.workspace_id AND f.fenced_at IS NOT NULL)
 ORDER BY a.expires_at,a.id LIMIT 100`;

			for (const candidate of rows) {
				const leaseOwner = randomUUID();
				let row: CrmChatAttachment | null;
				try {
					row = await serializable(this.prisma, async tx => {
						await workspaceLock(tx, candidate.workspaceId);
						await tx.$queryRaw`SELECT id FROM crm_access.crm_chat_attachments WHERE id=${candidate.id}::uuid FOR UPDATE`;
						const current = await tx.crmChatAttachment.findUniqueOrThrow({
							where: { id: candidate.id }
						});
						if (
							!['UPLOADING', 'READY', 'DELETING'].includes(current.state) ||
							(current.state !== 'DELETING' &&
								current.expiresAt.getTime() > Date.now()) ||
							(current.leaseUntil && current.leaseUntil.getTime() > Date.now())
						)
							return null;
						return tx.crmChatAttachment.update({
							where: { id: current.id, version: current.version },
							data: {
								state: 'DELETING',
								version: { increment: 1 },
								leaseOwner,
								leaseUntil: new Date(Date.now() + 120000)
							}
						});
					});
				} catch {
					continue;
				}
				if (!row) continue;
				try {
					this.objects.assertKey(
						row.privateObjectKey,
						row.workspaceId,
						row.conversationId
					);
					await this.objects.remove(row.privateObjectKey);
					await this.prisma.crmChatAttachment.updateMany({
						where: {
							id: row.id,
							state: 'DELETING',
							version: row.version,
							leaseOwner
						},
						data: {
							state: 'DELETED',
							version: { increment: 1 },
							leaseOwner: null,
							leaseUntil: null
						}
					});
				} catch {
					/* Retained DELETING metadata retries after its lease. */
				}
			}
			const page = await this.objects.candidates(this.cursor);
			this.cursor = page.nextCursor;
			for (const item of page.items) {
				if (
					item.createdAt.getTime() > Date.now() - 86400000 ||
					!item.key.startsWith('messenger/')
				)
					continue;
				const exists = await this.prisma.crmChatAttachment.findFirst({
					where: { privateObjectKey: item.key, state: { not: 'DELETED' } }
				});
				if (!exists) {
					const parts = item.key.split('/');
					try {
						this.objects.assertKey(item.key, parts[1] || '', parts[2] || '');
					} catch {
						continue;
					}
					await this.objects.remove(item.key);
				}
			}
		} finally {
			this.running = false;
		}
	}
}
