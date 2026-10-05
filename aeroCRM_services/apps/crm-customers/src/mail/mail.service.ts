import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException
} from '@nestjs/common';
import {
	Prisma,
	MailMailbox,
	MailMessage,
	MailSendIntent,
	MailAttachment
} from '@prisma/crm-customers-client';
import { randomUUID } from 'node:crypto';
import { CrmCustomersPrismaService } from '../prisma/crm-customers-prisma.service';
import { customerScope } from '../customers/customers.service';
import {
	MailAuthority,
	MailAuthorizationClient,
	assertMailPermission
} from './mail-authorization.client';
import {
	MailConfig,
	MAIL_LIMITS,
	digest,
	canonicalMailJson
} from './mail.config';
import { prepareMailBody } from './mail.body';
import { MailTransport, endpoint } from './mail.transport';
import { MailObjects, safeMailFilename } from './mail.objects';
import {
	MailConnectDto,
	MailReconnectDto,
	MailFoldersDto,
	MailGrantsDto,
	MailDisconnectDto,
	MailLinkDto,
	MailPrepareAttachmentDto,
	MailSendDto,
	MailUploadDto,
	MailQueryDto,
	MailMessagesQuery,
	MailNotificationsQuery,
	MailNotificationReadDto
} from './mail.dto';
export type MailTx = Prisma.TransactionClient;
export interface MailAddress {
	email: string;
	name: string | null;
}
export const addressList = (value: Prisma.JsonValue): MailAddress[] =>
	value as unknown as MailAddress[];
const recipientList = (value: MailAddress[]) =>
	value.map((item) => ({ address: item.email, name: item.name || '' }));
const uuid =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function requireMailId(id: string): void {
	if (!uuid.test(id))
		throw new BadRequestException({ code: 'crm_mail_invalid_id' });
}
export function attachmentView(item: MailAttachment) {
	return {
		id: item.id,
		fileName: item.safeFileName,
		declaredMime: item.declaredMime,
		detectedMime: item.detectedMime,
		byteSize: item.byteSize,
		state: item.state,
		sha256: item.sha256,
		validationVersion: item.validationVersion,
		expiresAt: item.expiresAt?.toISOString() || null
	};
}
@Injectable()
export class MailService {
	constructor(
		readonly prisma: CrmCustomersPrismaService,
		readonly authorization: MailAuthorizationClient,
		readonly config: MailConfig,
		readonly transport: MailTransport,
		readonly objects: MailObjects
	) {}
	authority(token: string | undefined, workspaceId: string) {
		requireMailId(workspaceId);
		return this.authorization.authorize(token, workspaceId);
	}
	enabled() {
		if (!this.config.enabled)
			throw new ServiceUnavailableException({
				code: 'crm_mail_not_configured'
			});
	}
	async capabilities(a: MailAuthority) {
		const mailPermissions = a.mailPermissions.filter(
			(permission) =>
				permission !== 'mail:send' ||
				(this.config.sendEnabled && this.config.attachmentsAvailable)
		);
		return {
			schemaVersion: 1,
			workspaceId: a.customer.workspaceId,
			enabled: this.config.enabled,
			connectionAvailable: this.config.enabled,
			attachmentsAvailable: this.config.attachmentsAvailable,
			mailPermissions,
			canCreatePersonal:
				this.config.enabled && a.mailPermissions.includes('mail:send'),
			canCreateShared:
				this.config.enabled &&
				a.mailPermissions.includes('mail:manage') &&
				['OWNER', 'CRM_ADMIN'].includes(a.customer.role),
			attachmentLimits: MAIL_LIMITS
		};
	}
	async visibleMailboxIds(
		a: MailAuthority,
		permission: 'read' | 'send' | 'manage' = 'read',
		tx: MailTx = this.prisma
	): Promise<string[]> {
		assertMailPermission(a, `mail:${permission}`);
		const grants = await tx.mailMailboxGrant.findMany({
			where: {
				workspaceId: a.customer.workspaceId,
				subject: a.customer.subject,
				membershipId: a.membershipId,
				revokedAt: null,
				...{
					[`can${permission[0].toUpperCase() + permission.slice(1)}`]: true
				}
			},
			select: { mailboxId: true },
			take: 1001
		});
		if (grants.length > 1000)
			throw new ServiceUnavailableException({ code: 'crm_mail_acl_limit' });
		const personal = await tx.mailMailbox.findMany({
			where: {
				workspaceId: a.customer.workspaceId,
				kind: 'PERSONAL',
				ownerSubject: a.customer.subject,
				ownerMembershipId: a.membershipId
			},
			select: { id: true },
			take: 1001
		});
		if (personal.length > 1000)
			throw new ServiceUnavailableException({ code: 'crm_mail_acl_limit' });
		return [
			...new Set([
				...personal.map((x) => x.id),
				...grants.map((x) => x.mailboxId)
			])
		];
	}
	async mailbox(
		a: MailAuthority,
		id: string,
		permission: 'read' | 'send' | 'manage' = 'read',
		tx: MailTx = this.prisma
	): Promise<MailMailbox> {
		requireMailId(id);
		assertMailPermission(a, `mail:${permission}`);
		const m = await tx.mailMailbox.findFirst({
			where: { workspaceId: a.customer.workspaceId, id }
		});
		if (!m) throw new NotFoundException();
		if (m.kind === 'PERSONAL') {
			if (
				m.ownerSubject !== a.customer.subject ||
				m.ownerMembershipId !== a.membershipId
			)
				throw new NotFoundException();
		} else {
			const grant = await tx.mailMailboxGrant.findUnique({
				where: {
					workspaceId_mailboxId_subject_membershipId: {
						workspaceId: m.workspaceId,
						mailboxId: m.id,
						subject: a.customer.subject,
						membershipId: a.membershipId
					}
				}
			});
			if (
				!grant ||
				grant.revokedAt ||
				!(permission === 'read'
					? grant.canRead
					: permission === 'send'
						? grant.canSend
						: grant.canManage) ||
				(permission === 'manage' &&
					!['OWNER', 'CRM_ADMIN'].includes(a.customer.role))
			)
				throw new NotFoundException();
		}
		return m;
	}
	async contact(a: MailAuthority, id: string, tx: MailTx = this.prisma) {
		requireMailId(id);
		const contact = await tx.contact.findFirst({
			where: { ...customerScope(a.customer), id }
		});
		if (!contact) throw new NotFoundException();
		return contact;
	}
	async summary(a: MailAuthority, m: MailMailbox, tx: MailTx = this.prisma) {
		const connection = await tx.mailConnection.findUnique({
			where: { id: m.connectionId }
		});
		const permissions: string[] = [];
		for (const action of ['read', 'send', 'manage'] as const) {
			try {
				await this.mailbox(a, m.id, action, tx);
				if (
					action !== 'send' ||
					(this.config.sendEnabled && this.config.attachmentsAvailable)
				)
					permissions.push(action);
			} catch (error) {
				if (
					!(
						error instanceof NotFoundException ||
						error instanceof ForbiddenException
					)
				)
					throw error;
			}
		}
		const folders = await tx.mailFolder.findMany({
			where: { workspaceId: m.workspaceId, mailboxId: m.id, selected: true },
			select: { completedAt: true }
		});
		return {
			id: m.id,
			kind: m.kind,
			address: m.canonicalAddress,
			displayName: m.displayName,
			state: connection?.state || 'DISCONNECTED',
			version: m.version,
			permissions,
			syncStatus: !m.enabled
				? 'DISCONNECTED'
				: !folders.length
					? 'NOT_CONFIGURED'
					: m.safeErrorCode
						? 'ERROR'
						: folders.some((f) => !f.completedAt)
							? 'BACKFILL'
							: 'CURRENT',
			lastSyncAt: m.lastSyncAt?.toISOString() || null,
			safeErrorCode: m.safeErrorCode
		};
	}
	async mailboxes(a: MailAuthority, query?: MailQueryDto) {
		const ids = await this.visibleMailboxIds(a);
		const limit = query?.limit || 50;
		const filter = 'mailboxes';
		const cursor = this.parseCursor(a, filter, query?.cursor);
		const rows = await this.prisma.mailMailbox.findMany({
			where: {
				workspaceId: a.customer.workspaceId,
				id: { in: ids },
				...(cursor
					? {
							OR: [
								{ createdAt: { lt: cursor.createdAt } },
								{ createdAt: cursor.createdAt, id: { lt: cursor.id } }
							]
						}
					: {})
			},
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: limit + 1
		});
		const last = rows[limit - 1];
		return {
			schemaVersion: 1,
			workspaceId: a.customer.workspaceId,
			items: await Promise.all(
				rows.slice(0, limit).map((m) => this.summary(a, m))
			),
			nextCursor:
				rows.length > limit && last ? this.cursor(a, filter, last) : null
		};
	}

	hash(a: MailAuthority, operation: string, body: unknown) {
		return this.config.keyedDigest([
			a.customer.subject,
			a.membershipId,
			a.customer.workspaceId,
			operation,
			body
		]);
	}
	async receipt(
		a: MailAuthority,
		commandId: string,
		hash: string,
		tx: MailTx = this.prisma
	): Promise<Prisma.JsonValue | null> {
		const old = await tx.mailCommand.findUnique({ where: { commandId } });
		if (!old) return null;
		if (
			old.workspaceId !== a.customer.workspaceId ||
			old.actorSubject !== a.customer.subject ||
			old.requestHash !== hash
		)
			throw new ConflictException({ code: 'crm_mail_idempotency_conflict' });
		return old.response;
	}
	async command(
		a: MailAuthority,
		dto: { workspaceId: string; commandId: string },
		operation: string,
		hash: string,
		write: (tx: MailTx) => Promise<unknown>
	) {
		if (dto.workspaceId !== a.customer.workspaceId)
			throw new ForbiddenException();
		const fresh = await this.authorization.workflow(
			a.customer.workspaceId,
			a.customer.subject,
			a.membershipId,
			operation === 'PREPARE_ATTACHMENT' ? 'MAIL_SYNC' : 'MAIL_SEND'
		);
		if (
			fresh.customer.state === 'READ_ONLY' ||
			canonicalMailJson(fresh) !== canonicalMailJson(a)
		)
			throw new ForbiddenException({ code: 'crm_mail_authority_changed' });
		return this.prisma.$transaction(async (tx) => {
			await tx.$executeRaw`SET LOCAL lock_timeout='3000ms'`;
			await tx.$executeRaw`SELECT crm_customers.assert_workspace_open(${dto.workspaceId}::uuid)`;
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.commandId},0))`;
			const old = await this.receipt(a, dto.commandId, hash, tx);
			if (old) return old;
			const response = await write(tx);
			await tx.mailCommand.create({
				data: {
					commandId: dto.commandId,
					workspaceId: dto.workspaceId,
					actorSubject: a.customer.subject,
					requestHash: hash,
					response: response as Prisma.InputJsonValue
				}
			});
			await tx.mailAudit.create({
				data: {
					workspaceId: dto.workspaceId,
					actorSubject: a.customer.subject,
					action: operation,
					entityId: dto.commandId,
					commandId: dto.commandId,
					metadata: {}
				}
			});
			return response;
		});
	}
	async lockMailbox(
		a: MailAuthority,
		id: string,
		permission: 'send' | 'manage',
		tx: MailTx
	) {
		await tx.$queryRaw`SELECT id FROM crm_customers.mail_mailboxes WHERE workspace_id=${a.customer.workspaceId}::uuid AND id=${id}::uuid FOR UPDATE`;
		return this.mailbox(a, id, permission, tx);
	}
	assertVersion(m: MailMailbox, version: number) {
		if (m.version !== version)
			throw new ConflictException({ code: 'crm_mail_version_conflict' });
	}
	async connect(a: MailAuthority, dto: MailConnectDto) {
		this.enabled();
		assertMailPermission(
			a,
			dto.kind === 'SHARED' ? 'mail:manage' : 'mail:send'
		);
		if (
			dto.kind === 'SHARED' &&
			!['OWNER', 'CRM_ADMIN'].includes(a.customer.role)
		)
			throw new ForbiddenException();
		const imap = endpoint(dto.imap, 'imap'),
			smtp = endpoint(dto.smtp, 'smtp');
		const hash = this.hash(a, 'CONNECT', dto);
		const old = await this.receipt(a, dto.commandId, hash);
		if (old) return old;
		if (
			/[\x00-\x20\x7f]/.test(dto.address) ||
			!/^[^@]+@[^@]+\.[^@]+$/.test(dto.address) ||
			/[\x00-\x1f\x7f]/.test(dto.displayName)
		)
			throw new BadRequestException({ code: 'crm_mail_invalid_address' });
		const credentials = {
			password: dto.password,
			smtpPassword: dto.smtpPassword ?? dto.password
		};
		try {
			await this.transport.probe({ imap, smtp }, credentials);
		} catch {
			throw new BadRequestException({
				code: 'crm_mail_connection_failed',
				message:
					'Не удалось подтвердить безопасное IMAP/SMTP подключение. Проверьте серверы и пароль приложения.'
			});
		}
		const fresh = await this.authorization.workflow(
			dto.workspaceId,
			a.customer.subject,
			a.membershipId,
			'MAIL_SEND'
		);
		assertMailPermission(
			fresh,
			dto.kind === 'SHARED' ? 'mail:manage' : 'mail:send'
		);
		if (
			dto.kind === 'SHARED' &&
			!['OWNER', 'CRM_ADMIN'].includes(fresh.customer.role)
		)
			throw new ForbiddenException();
		return this.command(fresh, dto, 'CONNECT', hash, async (tx) => {
			const existing = await tx.mailMailbox.findUnique({
				where: {
					workspaceId_canonicalAddress: {
						workspaceId: dto.workspaceId,
						canonicalAddress: dto.address.trim().toLowerCase()
					}
				}
			});
			if (existing)
				throw new ConflictException({ code: 'crm_mail_address_exists' });
			const connectionId = randomUUID();
			const transport = { imap, smtp };
			const principal = smtp.username;
			const secret = this.config.encrypt(
				credentials,
				this.config.aad(
					dto.workspaceId,
					connectionId,
					principal,
					1,
					digest(canonicalMailJson(transport))
				)
			);
			await tx.mailConnection.create({
				data: {
					id: connectionId,
					workspaceId: dto.workspaceId,
					delegatedSubject: a.customer.subject,
					delegatedMembershipId: a.membershipId,
					provider: 'IMAP_SMTP',
					transport: transport as unknown as Prisma.InputJsonValue,
					authMode: 'PASSWORD',
					credentialPrincipal: principal,
					encryptedSecret: secret,
					keyId: this.config.keyId,
					state: 'ACTIVE'
				}
			});
			const m = await tx.mailMailbox.create({
				data: {
					workspaceId: dto.workspaceId,
					connectionId,
					kind: dto.kind,
					ownerSubject: dto.kind === 'PERSONAL' ? a.customer.subject : null,
					ownerMembershipId: dto.kind === 'PERSONAL' ? a.membershipId : null,
					canonicalAddress: dto.address.trim().toLowerCase(),
					displayName: dto.displayName,
					imapLogin: imap.username,
					smtpLogin: smtp.username,
					sendMode: 'AS',
					enabled: true
				}
			});
			if (dto.kind === 'SHARED')
				await tx.mailMailboxGrant.create({
					data: {
						workspaceId: dto.workspaceId,
						mailboxId: m.id,
						subject: a.customer.subject,
						membershipId: a.membershipId,
						canRead: true,
						canSend: true,
						canManage: true
					}
				});
			return {
				schemaVersion: 1,
				workspaceId: dto.workspaceId,
				item: await this.summary(fresh, m, tx)
			};
		});
	}

	async readConnection(a: MailAuthority, id: string) {
		const m = await this.mailbox(a, id, 'manage');
		const c = await this.prisma.mailConnection.findUniqueOrThrow({
			where: { id: m.connectionId }
		});
		return {
			schemaVersion: 1,
			workspaceId: m.workspaceId,
			item: this.transport.configuration(c)
		};
	}
	async reconnect(a: MailAuthority, id: string, dto: MailReconnectDto) {
		this.enabled();
		await this.mailbox(a, id, 'manage');
		const transport = {
			imap: endpoint(dto.imap, 'imap'),
			smtp: endpoint(dto.smtp, 'smtp')
		};
		const hash = this.hash(a, 'RECONNECT', [id, dto]);
		const old = await this.receipt(a, dto.commandId, hash);
		if (old) return old;
		const credentials = {
			password: dto.password,
			smtpPassword: dto.smtpPassword ?? dto.password
		};
		try {
			await this.transport.probe(transport, credentials);
		} catch {
			throw new BadRequestException({ code: 'crm_mail_connection_failed' });
		}
		const fresh = await this.authorization.workflow(
			dto.workspaceId,
			a.customer.subject,
			a.membershipId,
			'MAIL_SEND'
		);
		await this.mailbox(fresh, id, 'manage');
		return this.command(fresh, dto, 'RECONNECT', hash, async (tx) => {
			const m = await this.lockMailbox(fresh, id, 'manage', tx);
			this.assertVersion(m, dto.expectedVersion);
			const connectionId = randomUUID();
			const principal = transport.smtp.username;
			await tx.mailConnection.create({
				data: {
					id: connectionId,
					workspaceId: m.workspaceId,
					delegatedSubject: fresh.customer.subject,
					delegatedMembershipId: fresh.membershipId,
					provider: 'IMAP_SMTP',
					transport: transport as unknown as Prisma.InputJsonValue,
					authMode: 'PASSWORD',
					credentialPrincipal: principal,
					encryptedSecret: this.config.encrypt(
						credentials,
						this.config.aad(
							m.workspaceId,
							connectionId,
							principal,
							1,
							digest(canonicalMailJson(transport))
						)
					),
					keyId: this.config.keyId,
					state: 'ACTIVE'
				}
			});
			await tx.mailConnection.update({
				where: { id: m.connectionId },
				data: {
					state: 'DISCONNECTED',
					encryptedSecret: null,
					generation: { increment: 1 },
					version: { increment: 1 }
				}
			});
			const updated = await tx.mailMailbox.update({
				where: { id },
				data: {
					connectionId,
					imapLogin: transport.imap.username,
					smtpLogin: transport.smtp.username,
					enabled: true,
					disconnectedAt: null,
					generation: { increment: 1 },
					version: { increment: 1 },
					safeErrorCode: null
				}
			});
			await this.cancelUnadmittedJobs(tx, m.workspaceId, id);
			await tx.mailSendIntent.updateMany({
				where: {
					workspaceId: m.workspaceId,
					mailboxId: id,
					state: 'QUEUED',
					dispatchAdmittedAt: null
				},
				data: {
					state: 'CANCELLED',
					safeErrorCode: 'MAIL_GENERATION_CHANGED',
					settledAt: new Date(),
					version: { increment: 1 }
				}
			});
			await tx.mailFolder.updateMany({
				where: { workspaceId: m.workspaceId, mailboxId: id, selected: true },
				data: {
					uidValidity: null,
					generation: { increment: 1 },
					liveLastUid: 0n,
					backfillLastUid: 0n,
					backfillUpperUid: null,
					cutoff: null,
					importStartedAt: null,
					completedAt: null
				}
			});
			const folders = await tx.mailFolder.findMany({
				where: { workspaceId: m.workspaceId, mailboxId: id, selected: true }
			});
			for (const folder of folders) {
				await this.enqueue(tx, updated, 'LIVE_SYNC', folder.id);
				await this.enqueue(tx, updated, 'BACKFILL', folder.id);
			}
			return {
				schemaVersion: 1,
				workspaceId: m.workspaceId,
				item: await this.summary(fresh, updated, tx)
			};
		});
	}
	async folders(a: MailAuthority, id: string) {
		this.enabled();
		const m = await this.mailbox(a, id);
		const connection = await this.prisma.mailConnection.findUniqueOrThrow({
			where: { id: m.connectionId }
		});
		const authority = await this.authorization.workflow(
			m.workspaceId,
			connection.delegatedSubject,
			connection.delegatedMembershipId,
			'MAIL_SYNC'
		);
		await this.mailbox(authority, id);
		const rows = await this.transport.folders(connection);
		await this.authorization.workflow(
			m.workspaceId,
			connection.delegatedSubject,
			connection.delegatedMembershipId,
			'MAIL_SYNC'
		);
		const selected = await this.prisma.mailFolder.findMany({
			where: { workspaceId: m.workspaceId, mailboxId: id, selected: true }
		});
		if (rows.length > 500)
			throw new BadRequestException({ code: 'crm_mail_folder_limit' });
		return {
			schemaVersion: 1,
			workspaceId: m.workspaceId,
			items: rows.map((f) => ({
				path: f.path,
				name: f.name,
				kind:
					f.specialUse === '\\Sent'
						? 'SENT'
						: f.path.toUpperCase() === 'INBOX'
							? 'INBOX'
							: null,
				selected: selected.some((s) => s.exactPath === f.path)
			})),
			nextCursor: null
		};
	}
	async setFolders(a: MailAuthority, id: string, dto: MailFoldersDto) {
		this.enabled();
		await this.mailbox(a, id, 'manage');
		if (
			dto.folders.length < 1 ||
			dto.folders.length > 2 ||
			new Set(dto.folders.map((f) => f.kind)).size !== dto.folders.length ||
			new Set(dto.folders.map((f) => f.path)).size !== dto.folders.length
		)
			throw new BadRequestException({
				code: 'crm_mail_folder_selection_invalid'
			});
		const available = await this.folders(a, id);
		if (
			dto.folders.some(
				(f) => !available.items.some((row) => row.path === f.path)
			)
		)
			throw new BadRequestException({ code: 'crm_mail_folder_unknown' });
		return this.command(
			a,
			dto,
			'SELECT_FOLDERS',
			this.hash(a, 'SELECT_FOLDERS', [id, dto]),
			async (tx) => {
				const m = await this.lockMailbox(a, id, 'manage', tx);
				this.assertVersion(m, dto.expectedVersion);
				if (!m.enabled)
					throw new ConflictException({ code: 'crm_mail_disconnected' });
				await tx.mailFolder.updateMany({
					where: {
						workspaceId: dto.workspaceId,
						mailboxId: id,
						selected: true
					},
					data: { selected: false }
				});
				for (const folder of dto.folders) {
					const f = await tx.mailFolder.upsert({
						where: {
							workspaceId_mailboxId_exactPath: {
								workspaceId: dto.workspaceId,
								mailboxId: id,
								exactPath: folder.path
							}
						},
						create: {
							workspaceId: dto.workspaceId,
							mailboxId: id,
							exactPath: folder.path,
							kind: folder.kind,
							selected: true,
							generation: m.generation
						},
						update: { kind: folder.kind, selected: true }
					});
					await this.enqueue(tx, m, 'LIVE_SYNC', f.id);
					await this.enqueue(tx, m, 'BACKFILL', f.id);
				}
				const updated = await tx.mailMailbox.update({
					where: { id },
					data: { version: { increment: 1 } }
				});
				return {
					schemaVersion: 1,
					workspaceId: dto.workspaceId,
					item: await this.summary(a, updated, tx)
				};
			}
		);
	}
	async enqueue(
		tx: MailTx,
		m: MailMailbox,
		kind: string,
		targetId: string | null
	) {
		const workKey = `${m.id}:${m.generation}:${kind}:${targetId || '-'}`;
		await tx.mailJob.upsert({
			where: { workKey },
			create: {
				workspaceId: m.workspaceId,
				mailboxId: m.id,
				generation: m.generation,
				kind,
				targetId,
				workKey,
				state: 'QUEUED'
			},
			update: {
				state: 'QUEUED',
				dueAt: new Date(),
				leaseOwner: null,
				leaseUntil: null,
				safeErrorCode: null,
				attempts: 0
			}
		});
	}
	async cancelUnadmittedJobs(
		tx: MailTx,
		workspaceId: string,
		mailboxId: string
	) {
		await tx.$executeRaw`UPDATE crm_customers.mail_jobs j SET state='CANCELLED',lease_owner=NULL,lease_until=NULL WHERE j.workspace_id=${workspaceId}::uuid AND j.mailbox_id=${mailboxId}::uuid AND j.state IN ('QUEUED','RUNNING') AND (j.kind <> 'SEND' OR NOT EXISTS (SELECT 1 FROM crm_customers.mail_send_intents s WHERE s.workspace_id=j.workspace_id AND s.id=j.target_id AND s.dispatch_admitted_at IS NOT NULL))`;
	}

	async grants(a: MailAuthority, id: string, dto: MailGrantsDto) {
		const m = await this.mailbox(a, id, 'manage');
		if (
			m.kind !== 'SHARED' ||
			dto.grants.length > 100 ||
			new Set(dto.grants.map((g) => g.subject)).size !== dto.grants.length
		)
			throw new BadRequestException({ code: 'crm_mail_grants_invalid' });
		for (const grant of dto.grants) {
			if ((grant.send || grant.manage) && !grant.read)
				throw new BadRequestException();
			const fresh = await this.authorization.workflow(
				dto.workspaceId,
				grant.subject,
				grant.membershipId,
				'MAIL_SYNC'
			);
			if (
				(grant.send && !fresh.mailPermissions.includes('mail:send')) ||
				(grant.manage &&
					(!fresh.mailPermissions.includes('mail:manage') ||
						!['OWNER', 'CRM_ADMIN'].includes(fresh.customer.role)))
			)
				throw new BadRequestException({ code: 'crm_mail_grant_not_allowed' });
		}
		if (
			!dto.grants.some(
				(g) =>
					g.subject === a.customer.subject &&
					g.membershipId === a.membershipId &&
					g.manage
			)
		)
			throw new BadRequestException({ code: 'crm_mail_keep_manager' });
		return this.command(
			a,
			dto,
			'SET_GRANTS',
			this.hash(a, 'SET_GRANTS', [id, dto]),
			async (tx) => {
				const current = await this.lockMailbox(a, id, 'manage', tx);
				this.assertVersion(current, dto.expectedVersion);
				await tx.mailMailboxGrant.updateMany({
					where: {
						workspaceId: dto.workspaceId,
						mailboxId: id,
						revokedAt: null
					},
					data: { revokedAt: new Date() }
				});
				for (const grant of dto.grants)
					await tx.mailMailboxGrant.upsert({
						where: {
							workspaceId_mailboxId_subject_membershipId: {
								workspaceId: dto.workspaceId,
								mailboxId: id,
								subject: grant.subject,
								membershipId: grant.membershipId
							}
						},
						create: {
							workspaceId: dto.workspaceId,
							mailboxId: id,
							subject: grant.subject,
							membershipId: grant.membershipId,
							canRead: grant.read,
							canSend: grant.send,
							canManage: grant.manage
						},
						update: {
							canRead: grant.read,
							canSend: grant.send,
							canManage: grant.manage,
							revokedAt: null
						}
					});
				const updated = await tx.mailMailbox.update({
					where: { id },
					data: { generation: { increment: 1 }, version: { increment: 1 } }
				});
				await this.cancelUnadmittedJobs(tx, dto.workspaceId, id);
				await tx.mailSendIntent.updateMany({
					where: {
						workspaceId: dto.workspaceId,
						mailboxId: id,
						state: 'QUEUED',
						dispatchAdmittedAt: null
					},
					data: {
						state: 'CANCELLED',
						safeErrorCode: 'MAIL_GENERATION_CHANGED',
						settledAt: new Date(),
						version: { increment: 1 }
					}
				});
				const folders = await tx.mailFolder.findMany({
					where: {
						workspaceId: dto.workspaceId,
						mailboxId: id,
						selected: true
					}
				});
				for (const folder of folders) {
					await this.enqueue(tx, updated, 'LIVE_SYNC', folder.id);
					await this.enqueue(tx, updated, 'BACKFILL', folder.id);
				}
				return {
					schemaVersion: 1,
					workspaceId: dto.workspaceId,
					item: await this.summary(a, updated, tx)
				};
			}
		);
	}
	async disconnect(a: MailAuthority, id: string, dto: MailDisconnectDto) {
		await this.mailbox(a, id, 'manage');
		return this.command(
			a,
			dto,
			'DISCONNECT',
			this.hash(a, 'DISCONNECT', [id, dto]),
			async (tx) => {
				const m = await this.lockMailbox(a, id, 'manage', tx);
				this.assertVersion(m, dto.expectedVersion);
				const updated = await tx.mailMailbox.update({
					where: { id },
					data: {
						enabled: false,
						disconnectedAt: new Date(),
						generation: { increment: 1 },
						version: { increment: 1 }
					}
				});
				await tx.mailConnection.update({
					where: { id: m.connectionId },
					data: {
						state: 'DISCONNECTED',
						encryptedSecret: null,
						generation: { increment: 1 },
						version: { increment: 1 }
					}
				});
				await this.cancelUnadmittedJobs(tx, dto.workspaceId, id);
				await tx.mailSendIntent.updateMany({
					where: {
						workspaceId: dto.workspaceId,
						mailboxId: id,
						state: 'QUEUED',
						dispatchAdmittedAt: null
					},
					data: {
						state: 'CANCELLED',
						settledAt: new Date(),
						version: { increment: 1 }
					}
				});
				return {
					schemaVersion: 1,
					workspaceId: dto.workspaceId,
					item: await this.summary(a, updated, tx)
				};
			}
		);
	}
	async readGrants(a: MailAuthority, id: string) {
		const m = await this.mailbox(a, id, 'manage');
		if (
			m.kind !== 'SHARED' ||
			!['OWNER', 'CRM_ADMIN'].includes(a.customer.role)
		)
			throw new NotFoundException();
		const rows = await this.prisma.mailMailboxGrant.findMany({
			where: { workspaceId: m.workspaceId, mailboxId: id, revokedAt: null },
			orderBy: { subject: 'asc' },
			take: 100
		});
		return {
			schemaVersion: 1,
			workspaceId: m.workspaceId,
			items: rows.map((g) => ({
				subject: g.subject,
				membershipId: g.membershipId,
				read: g.canRead,
				send: g.canSend,
				manage: g.canManage
			})),
			nextCursor: null
		};
	}
	cursor(
		a: MailAuthority,
		filter: string,
		row: { id: string; createdAt: Date }
	): string {
		const payload = Buffer.from(
			JSON.stringify({
				workspaceId: a.customer.workspaceId,
				subject: a.customer.subject,
				membershipId: a.membershipId,
				filter,
				id: row.id,
				createdAt: row.createdAt.toISOString()
			})
		).toString('base64url');
		return `${payload}.${this.config.keyedDigest(payload)}`;
	}
	parseCursor(
		a: MailAuthority,
		filter: string,
		value?: string
	): { id: string; createdAt: Date } | null {
		if (!value) return null;
		try {
			if (value.length > 2048) throw new Error();
			const [payload, hash, ...extra] = value.split('.');
			if (extra.length || this.config.keyedDigest(payload) !== hash)
				throw new Error();
			const v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
			if (
				v.workspaceId !== a.customer.workspaceId ||
				v.subject !== a.customer.subject ||
				v.membershipId !== a.membershipId ||
				v.filter !== filter ||
				!uuid.test(v.id) ||
				new Date(v.createdAt).toISOString() !== v.createdAt
			)
				throw new Error();
			return { id: v.id, createdAt: new Date(v.createdAt) };
		} catch {
			throw new BadRequestException({ code: 'crm_mail_invalid_cursor' });
		}
	}
	async contactMessages(
		a: MailAuthority,
		contactId: string,
		query: MailQueryDto
	) {
		await this.contact(a, contactId);
		const ids = await this.visibleMailboxIds(a);
		if (query.mailboxId) {
			await this.mailbox(a, query.mailboxId);
			ids.splice(0, ids.length, query.mailboxId);
		}
		const filter = `contact:${contactId}:${query.mailboxId || '-'}`;
		const cursor = this.parseCursor(a, filter, query.cursor);
		const limit = query.limit || 50;
		const rows = ids.length
			? await this.prisma.$queryRaw<
					Array<{ id: string; source_kind: string; created_at: Date }>
				>(Prisma.sql`
 SELECT id,source_kind,created_at FROM (
  SELECT m.id,'IMAP'::text AS source_kind,m.created_at FROM crm_customers.mail_messages m WHERE m.workspace_id=${a.customer.workspaceId}::uuid AND m.mailbox_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND EXISTS (SELECT 1 FROM crm_customers.mail_contact_links l WHERE l.workspace_id=m.workspace_id AND l.message_id=m.id AND l.contact_id=${contactId}::uuid AND l.state='LINKED')
  UNION ALL SELECT s.id,'CRM_SEND'::text AS source_kind,s.created_at FROM crm_customers.mail_send_intents s WHERE s.workspace_id=${a.customer.workspaceId}::uuid AND s.contact_id=${contactId}::uuid AND s.mailbox_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
 ) visible WHERE ${cursor ? Prisma.sql`(created_at,id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.sql`TRUE`} ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`)
			: [];
		const items = [];
		for (const row of rows.slice(0, limit)) {
			items.push(
				row.source_kind === 'IMAP'
					? await this.messageSummary(
							await this.prisma.mailMessage.findUniqueOrThrow({
								where: { id: row.id }
							})
						)
					: await this.intentSummary(
							await this.prisma.mailSendIntent.findUniqueOrThrow({
								where: { id: row.id }
							})
						)
			);
		}
		const last = rows[limit - 1];
		return {
			schemaVersion: 1,
			workspaceId: a.customer.workspaceId,
			items,
			nextCursor:
				rows.length > limit && last
					? this.cursor(a, filter, { id: last.id, createdAt: last.created_at })
					: null
		};
	}
	async messages(a: MailAuthority, query: MailMessagesQuery) {
		this.enabled();
		const filter = `workspace:${query.folder}:${query.mailboxId || '-'}`;
		const cursor = this.parseCursor(a, filter, query.cursor);
		const limit = query.limit || 50;
		return this.prisma.$transaction(
			async (tx) => {
				const mailboxIds = await this.visibleMailboxIds(a, 'read', tx);
				if (query.mailboxId) {
					await this.mailbox(a, query.mailboxId, 'read', tx);
					mailboxIds.splice(0, mailboxIds.length, query.mailboxId);
				}
				const before = cursor
					? {
							OR: [
								{ createdAt: { lt: cursor.createdAt } },
								{ createdAt: cursor.createdAt, id: { lt: cursor.id } }
							]
						}
					: {};
				const binding = {
					workspaceId: a.customer.workspaceId,
					mailboxId: { in: mailboxIds },
					...before
				};
				const [imported, sent] = await Promise.all([
					tx.mailMessage.findMany({
						where: {
							AND: [
								binding,
								{
									direction: query.folder === 'INBOX' ? 'INBOUND' : 'OUTBOUND',
									OR: [
										{
											mailContactLink_messageId: { none: { state: 'LINKED' } }
										},
										{
											mailContactLink_messageId: {
												some: {
													state: 'LINKED',
													contact: customerScope(a.customer)
												}
											}
										}
									]
								}
							]
						},
						orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
						take: limit + 1
					}),
					query.folder === 'SENT'
						? tx.mailSendIntent.findMany({
								where: {
									AND: [
										binding,
										{
											OR: [
												{
													contactId: null,
													OR: [
														{ scopeMessageId: null },
														{
															scopeMessage: {
																OR: [
																	{
																		mailContactLink_messageId: {
																			none: { state: 'LINKED' }
																		}
																	},
																	{
																		mailContactLink_messageId: {
																			some: {
																				state: 'LINKED',
																				contact: customerScope(a.customer)
																			}
																		}
																	}
																]
															}
														}
													]
												},
												{ contact: customerScope(a.customer) }
											]
										}
									]
								},
								orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
								take: limit + 1
							})
						: Promise.resolve([])
				]);
				const rows = [
					...imported.map((row) => ({ row, source: 'IMAP' as const })),
					...sent.map((row) => ({ row, source: 'CRM_SEND' as const }))
				].sort(
					(a, b) =>
						b.row.createdAt.getTime() - a.row.createdAt.getTime() ||
						(a.row.id < b.row.id ? 1 : a.row.id > b.row.id ? -1 : 0)
				);
				const items = await Promise.all(
					rows
						.slice(0, limit)
						.map((item) =>
							item.source === 'IMAP'
								? this.messageSummary(item.row, tx)
								: this.intentSummary(item.row, tx)
						)
				);
				const last = rows[limit - 1]?.row;
				return {
					schemaVersion: 1,
					workspaceId: a.customer.workspaceId,
					items,
					nextCursor:
						rows.length > limit && last ? this.cursor(a, filter, last) : null
				};
			},
			{ isolationLevel: 'RepeatableRead' }
		);
	}

	async messageSummary(m: MailMessage, tx: MailTx = this.prisma) {
		const attachmentCount = await tx.mailAttachment.count({
			where: { workspaceId: m.workspaceId, messageId: m.id }
		});
		return {
			id: m.id,
			mailboxId: m.mailboxId,
			direction: m.direction,
			subject: m.subject,
			from: addressList(m.from),
			to: addressList(m.to),
			cc: addressList(m.cc),
			sentAt: m.sentAt?.toISOString() || null,
			receivedAt: m.receivedAt.toISOString(),
			attachmentCount,
			sourceKind: 'IMAP',
			state: null,
			createdAt: m.createdAt.toISOString()
		};
	}
	async intentSummary(s: MailSendIntent, tx: MailTx = this.prisma) {
		const m = await tx.mailMailbox.findUniqueOrThrow({
			where: { id: s.mailboxId }
		});
		return {
			id: s.id,
			mailboxId: s.mailboxId,
			direction: 'OUTBOUND',
			subject: s.subject,
			from: [{ email: m.canonicalAddress, name: m.displayName }],
			to: addressList(s.to),
			cc: addressList(s.cc),
			sentAt: s.dispatchAdmittedAt?.toISOString() || null,
			receivedAt: s.createdAt.toISOString(),
			attachmentCount: s.attachmentIds.length,
			sourceKind: 'CRM_SEND',
			state: s.state,
			createdAt: s.createdAt.toISOString()
		};
	}
	async readableMessage(
		a: MailAuthority,
		id: string,
		tx: MailTx = this.prisma
	): Promise<MailMessage> {
		requireMailId(id);
		const m = await tx.mailMessage.findFirst({
			where: { workspaceId: a.customer.workspaceId, id }
		});
		if (!m) throw new NotFoundException();
		await this.mailbox(a, m.mailboxId, 'read', tx);
		const links = await tx.mailContactLink.findMany({
			where: {
				workspaceId: m.workspaceId,
				messageId: id,
				state: 'LINKED',
				contactId: { not: null }
			}
		});
		if (
			links.length &&
			!(await tx.contact.findFirst({
				where: {
					...customerScope(a.customer),
					id: { in: links.map((link) => link.contactId!) }
				}
			}))
		)
			throw new NotFoundException();
		return m;
	}
	async readableIntent(a: MailAuthority, id: string, tx: MailTx = this.prisma) {
		requireMailId(id);
		const s = await tx.mailSendIntent.findFirst({
			where: { workspaceId: a.customer.workspaceId, id }
		});
		if (!s) throw new NotFoundException();
		await this.mailbox(a, s.mailboxId, 'read', tx);
		if (s.contactId) await this.contact(a, s.contactId, tx);
		else if (s.scopeMessageId)
			await this.readableMessage(a, s.scopeMessageId, tx);
		return s;
	}
	async message(
		a: MailAuthority,
		id: string,
		unmatchedMailboxId?: string,
		bodyFormat?: 'html'
	) {
		requireMailId(id);
		const imported = await this.prisma.mailMessage.findFirst({
			where: { workspaceId: a.customer.workspaceId, id }
		});
		if (!imported) {
			if (unmatchedMailboxId) throw new NotFoundException();
			const intent = await this.readableIntent(a, id);
			const attachments = await this.prisma.mailAttachment.findMany({
				where: {
					workspaceId: intent.workspaceId,
					id: { in: intent.attachmentIds }
				}
			});
			let bcc: MailAddress[] = [];
			if (
				intent.actorSubject === a.customer.subject &&
				intent.membershipId === a.membershipId
			)
				bcc = addressList(intent.bcc);
			else {
				try {
					await this.mailbox(a, intent.mailboxId, 'send');
					bcc = addressList(intent.bcc);
				} catch (error) {
					if (
						!(
							error instanceof ForbiddenException ||
							error instanceof NotFoundException
						)
					)
						throw error;
				}
			}
			return {
				schemaVersion: 1,
				workspaceId: intent.workspaceId,
				item: {
					...(await this.intentSummary(intent)),
					text: intent.text,
					...(bodyFormat === 'html' ? { html: intent.html } : {}),
					bodyStatus: 'COMPLETE',
					bcc,
					attachments: attachments.map(attachmentView),
					links: intent.contactId
						? [
								{
									externalEmail: addressList(intent.to)[0]?.email || '',
									contactId: intent.contactId,
									state: 'LINKED',
									version: 1
								}
							]
						: [],
					provenance: {
						folderPath: null,
						uidValidity: null,
						uid: null,
						messageId: intent.messageId,
						inReplyTo: null,
						references: []
					}
				}
			};
		}
		let m: MailMessage;
		if (unmatchedMailboxId) {
			await this.mailbox(a, unmatchedMailboxId);
			if (imported.mailboxId !== unmatchedMailboxId)
				throw new NotFoundException();
			const linked = await this.prisma.mailContactLink.findFirst({
				where: {
					workspaceId: a.customer.workspaceId,
					messageId: id,
					state: 'LINKED'
				}
			});
			m = linked ? await this.readableMessage(a, id) : imported;
		} else m = await this.readableMessage(a, id);
		const folder = await this.prisma.mailFolder.findUniqueOrThrow({
			where: { id: m.folderId }
		});
		const links = await this.prisma.mailContactLink.findMany({
			where: { workspaceId: m.workspaceId, messageId: id }
		});
		const visible = await this.prisma.contact.findMany({
			where: {
				...customerScope(a.customer),
				id: {
					in: links
						.map((l) => l.contactId)
						.filter((v): v is string => Boolean(v))
				}
			},
			select: { id: true }
		});
		const visibleIds = new Set(visible.map((v) => v.id));
		const attachments = await this.prisma.mailAttachment.findMany({
			where: { workspaceId: m.workspaceId, messageId: id }
		});
		let bcc: MailAddress[] = [];
		try {
			await this.mailbox(a, m.mailboxId, 'send');
			bcc = addressList(m.bcc);
		} catch (error) {
			if (
				!(
					error instanceof ForbiddenException ||
					error instanceof NotFoundException
				)
			)
				throw error;
		}
		return {
			schemaVersion: 1,
			workspaceId: m.workspaceId,
			item: {
				...(await this.messageSummary(m)),
				text: m.plainText,
				...(bodyFormat === 'html' ? { html: null } : {}),
				bodyStatus: m.bodyStatus,
				bcc,
				attachments: attachments.map(attachmentView),
				links: links
					.filter((l) => !l.contactId || visibleIds.has(l.contactId))
					.map((l) => ({
						externalEmail: l.externalEmail,
						contactId: l.contactId,
						state: l.state,
						version: l.version
					})),
				provenance: {
					folderPath: folder.exactPath,
					uidValidity: m.uidValidity.toString(),
					uid: m.uid.toString(),
					messageId: m.messageId,
					inReplyTo: m.inReplyTo,
					references: m.references
				}
			}
		};
	}
	private async notificationScope(
		a: MailAuthority,
		tx: MailTx,
		linkedOnly = false
	) {
		this.enabled();
		const mailboxIds = await this.visibleMailboxIds(a, 'read', tx);
		return {
			workspaceId: a.customer.workspaceId,
			message: {
				workspaceId: a.customer.workspaceId,
				mailboxId: { in: mailboxIds },
				OR: [
					...(linkedOnly
						? []
						: [
								{
									mailContactLink_messageId: { none: { state: 'LINKED' } }
								}
							]),
					{
						mailContactLink_messageId: {
							some: { state: 'LINKED', contact: customerScope(a.customer) }
						}
					}
				]
			}
		};
	}
	async notifications(
		a: MailAuthority,
		query: MailNotificationsQuery,
		schemaVersion: 1 | 2 = 1
	) {
		if (query.workspaceId !== a.customer.workspaceId)
			throw new ForbiddenException();
		return this.prisma.$transaction(
			async (tx) => {
				const scope = await this.notificationScope(a, tx, schemaVersion === 1);
				const reader = {
					recipientSubject: a.customer.subject,
					recipientMembershipId: a.membershipId
				};
				const unread = {
					reads: { none: { ...reader, readAt: { not: null } } }
				};
				const where = {
					...scope,
					...(query.unreadOnly === 'true' ? unread : {})
				};
				const [total, unreadCount, rows] = await Promise.all([
					tx.mailNotification.count({ where }),
					tx.mailNotification.count({ where: { ...scope, ...unread } }),
					tx.mailNotification.findMany({
						where,
						orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
						skip: (query.page - 1) * query.pageSize,
						take: query.pageSize,
						include: {
							reads: { where: reader },
							message: {
								select: {
									subject: true,
									mailboxId: true,
									mailContactLink_messageId: {
										where: {
											state: 'LINKED',
											contact: customerScope(a.customer)
										},
										orderBy: [{ contactId: 'asc' }, { id: 'asc' }],
										take: 1,
										select: { contactId: true }
									}
								}
							}
						}
					})
				]);
				return {
					schemaVersion,
					workspaceId: query.workspaceId,
					page: query.page,
					pageSize: query.pageSize,
					total,
					unreadCount,
					items: rows.map((row) => ({
						id: row.id,
						messageId: row.messageId,
						...(schemaVersion === 2
							? { mailboxId: row.message.mailboxId }
							: {}),
						contactId:
							row.message.mailContactLink_messageId[0]?.contactId ?? null,
						title:
							row.message.subject
								.replace(/[\x00-\x1f\x7f]/g, ' ')
								.trim()
								.slice(0, 200) || 'Без темы',
						createdAt: row.createdAt.toISOString(),
						readAt: row.reads[0]?.readAt?.toISOString() ?? null
					}))
				};
			},
			{ isolationLevel: 'RepeatableRead' }
		);
	}
	async readNotification(
		a: MailAuthority,
		id: string,
		dto: MailNotificationReadDto
	) {
		requireMailId(id);
		if (dto.workspaceId !== a.customer.workspaceId)
			throw new ForbiddenException();
		return this.prisma.$transaction(
			async (tx) => {
				const scope = await this.notificationScope(a, tx);
				const notification = await tx.mailNotification.findFirst({
					where: { id, ...scope }
				});
				if (!notification) throw new NotFoundException();
				const rows = await tx.$queryRaw<{ readAt: Date | null }[]>(Prisma.sql`
				INSERT INTO crm_customers.mail_notification_reads
				(workspace_id,notification_id,recipient_subject,recipient_membership_id,read_at)
				VALUES (${dto.workspaceId}::uuid,${id}::uuid,${a.customer.subject},${a.membershipId}::uuid,${dto.read ? new Date() : null})
				ON CONFLICT (notification_id,recipient_subject,recipient_membership_id) DO UPDATE
				SET read_at=CASE WHEN ${dto.read} THEN COALESCE(mail_notification_reads.read_at,EXCLUDED.read_at) ELSE NULL END
				RETURNING read_at AS "readAt"`);
				return {
					schemaVersion: 1,
					workspaceId: dto.workspaceId,
					id,
					readAt: rows[0].readAt?.toISOString() ?? null
				};
			},
			{ isolationLevel: 'RepeatableRead' }
		);
	}

	async unmatched(a: MailAuthority, id: string, query: MailQueryDto) {
		await this.mailbox(a, id);
		const filter = `unmatched:${id}`;
		const cursor = this.parseCursor(a, filter, query.cursor);
		const limit = query.limit || 50;
		const rows = await this.prisma.$queryRaw<MailMessage[]>(
			Prisma.sql`SELECT m.id FROM crm_customers.mail_messages m WHERE m.workspace_id=${a.customer.workspaceId}::uuid AND m.mailbox_id=${id}::uuid AND NOT EXISTS (SELECT 1 FROM crm_customers.mail_contact_links l WHERE l.workspace_id=m.workspace_id AND l.message_id=m.id AND l.state='LINKED') AND ${cursor ? Prisma.sql`(m.created_at,m.id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.sql`TRUE`} ORDER BY m.created_at DESC,m.id DESC LIMIT ${limit + 1}`
		);
		const messages = await this.prisma.mailMessage.findMany({
			where: {
				workspaceId: a.customer.workspaceId,
				id: { in: rows.slice(0, limit).map((row) => row.id) }
			},
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
		});
		const items = [];
		for (const m of messages) items.push(await this.messageSummary(m));
		const last = messages[limit - 1];
		return {
			schemaVersion: 1,
			workspaceId: a.customer.workspaceId,
			items,
			nextCursor:
				rows.length > limit && last ? this.cursor(a, filter, last) : null
		};
	}
	async link(a: MailAuthority, id: string, dto: MailLinkDto) {
		assertMailPermission(a, 'mail:read');
		await this.contact(a, dto.contactId);
		requireMailId(id);
		const m = await this.prisma.mailMessage.findFirst({
			where: { workspaceId: dto.workspaceId, id }
		});
		if (!m) throw new NotFoundException();
		await this.mailbox(a, m.mailboxId);
		if (
			!a.customer.permissions.includes('customers:write') ||
			a.customer.state === 'READ_ONLY'
		)
			await this.mailbox(a, m.mailboxId, 'manage');
		const email = dto.externalEmail.trim().toLowerCase();
		const external =
			m.direction === 'INBOUND'
				? addressList(m.from)
				: [...addressList(m.to), ...addressList(m.cc)];
		if (!external.some((e) => e.email === email))
			throw new BadRequestException({
				code: 'crm_mail_external_email_invalid'
			});
		return this.command(
			a,
			dto,
			'LINK',
			this.hash(a, 'LINK', [id, dto]),
			async (tx) => {
				await this.mailbox(a, m.mailboxId, 'read', tx);
				await this.contact(a, dto.contactId, tx);
				const current = await tx.mailContactLink.findUnique({
					where: {
						workspaceId_messageId_externalEmail: {
							workspaceId: dto.workspaceId,
							messageId: id,
							externalEmail: email
						}
					}
				});
				if (!current || current.version !== dto.expectedVersion)
					throw new ConflictException({ code: 'crm_mail_version_conflict' });
				if (
					await tx.mailContactLink.findFirst({
						where: {
							workspaceId: dto.workspaceId,
							messageId: id,
							state: 'LINKED'
						}
					})
				)
					await this.readableMessage(a, id, tx);
				if (current.contactId) await this.contact(a, current.contactId, tx);
				const changed = await tx.mailContactLink.updateMany({
					where: { id: current.id, version: dto.expectedVersion },
					data: {
						contactId: dto.contactId,
						state: 'LINKED',
						method: 'MANUAL',
						actorSubject: a.customer.subject,
						version: { increment: 1 }
					}
				});
				if (changed.count !== 1)
					throw new ConflictException({ code: 'crm_mail_version_conflict' });
				const link = await tx.mailContactLink.findUniqueOrThrow({
					where: { id: current.id }
				});

				return {
					schemaVersion: 1,
					workspaceId: dto.workspaceId,
					item: {
						externalEmail: link.externalEmail,
						contactId: link.contactId,
						state: link.state,
						version: link.version
					}
				};
			}
		);
	}
	async attachment(
		a: MailAuthority,
		id: string,
		tx: MailTx = this.prisma
	): Promise<MailAttachment> {
		requireMailId(id);
		const file = await tx.mailAttachment.findFirst({
			where: { workspaceId: a.customer.workspaceId, id }
		});
		if (!file) throw new NotFoundException();
		await this.mailbox(a, file.mailboxId, 'read', tx);
		if (file.messageId) await this.readableMessage(a, file.messageId, tx);
		else {
			if (file.contactId) await this.contact(a, file.contactId, tx);
			const bound = await tx.mailSendAttachment.findFirst({
				where: { workspaceId: file.workspaceId, attachmentId: file.id }
			});
			if (bound) await this.readableIntent(a, bound.sendId, tx);
			else if (
				file.uploadActor !== a.customer.subject ||
				file.uploadMembershipId !== a.membershipId
			)
				throw new NotFoundException();
		}
		if (
			file.uploadActor &&
			file.expiresAt &&
			file.expiresAt.getTime() < Date.now() &&
			!(await tx.mailSendAttachment.findFirst({
				where: { workspaceId: file.workspaceId, attachmentId: file.id }
			}))
		)
			throw new NotFoundException();
		return file;
	}
	async attachmentMetadata(a: MailAuthority, id: string) {
		const file = await this.attachment(a, id);
		return {
			schemaVersion: 1,
			workspaceId: file.workspaceId,
			item: attachmentView(file)
		};
	}
	async content(a: MailAuthority, id: string) {
		const file = await this.attachment(a, id);
		if (file.state !== 'VALIDATED' || !file.privateObjectKey || !file.sha256)
			throw new ConflictException({
				code: 'crm_mail_attachment_not_validated'
			});
		this.objects.assertKey(
			file.privateObjectKey,
			file.workspaceId,
			file.mailboxId
		);
		const bytes = await this.objects.get(file.privateObjectKey);
		if (bytes.length !== file.byteSize || digest(bytes) !== file.sha256)
			throw new ServiceUnavailableException({
				code: 'crm_mail_attachment_integrity'
			});
		const fresh = await this.authorization.workflow(
			a.customer.workspaceId,
			a.customer.subject,
			a.membershipId,
			'MAIL_SYNC'
		);
		await this.attachment(fresh, id);
		return { file, bytes };
	}
	async upload(
		a: MailAuthority,
		dto: MailUploadDto,
		file: {
			originalname: string;
			mimetype: string;
			buffer: Buffer;
			size: number;
		}
	) {
		const contactId = dto.contactId ?? null;
		const normalized = { ...dto, contactId };
		this.enabled();
		if (!this.config.attachmentsAvailable)
			throw new ServiceUnavailableException({
				code: 'crm_mail_objects_not_configured'
			});
		await this.mailbox(a, dto.mailboxId, 'send');
		if (contactId) await this.contact(a, contactId);
		if (
			!file ||
			file.size > MAIL_LIMITS.maxFileBytes ||
			file.buffer.length !== file.size
		)
			throw new BadRequestException({ code: 'crm_mail_file_invalid' });
		const fileName = safeMailFilename(file.originalname);
		const sha256 = digest(file.buffer);
		const hash = this.hash(a, 'UPLOAD', [
			normalized,
			fileName,
			file.mimetype,
			sha256
		]);
		const old = await this.receipt(a, dto.commandId, hash);
		if (old) return old;
		const id = randomUUID();
		const key = this.objects.key(dto.workspaceId, dto.mailboxId, id);
		await this.objects.put(key, file.buffer);
		const fresh = await this.authorization.workflow(
			dto.workspaceId,
			a.customer.subject,
			a.membershipId,
			'MAIL_SEND'
		);
		await this.mailbox(fresh, dto.mailboxId, 'send');
		if (contactId) await this.contact(fresh, contactId);
		return this.command(fresh, normalized, 'UPLOAD', hash, async (tx) => {
			const m = await this.lockMailbox(fresh, dto.mailboxId, 'send', tx);
			if (contactId) await this.contact(fresh, contactId, tx);
			const item = await tx.mailAttachment.create({
				data: {
					id,
					workspaceId: dto.workspaceId,
					mailboxId: m.id,
					contactId: contactId,
					uploadActor: a.customer.subject,
					uploadMembershipId: a.membershipId,
					safeFileName: fileName,
					declaredMime: file.mimetype,
					byteSize: file.size,
					sha256,
					privateObjectKey: key,
					state: 'QUARANTINED',
					expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
				}
			});
			await this.enqueue(tx, m, 'VALIDATE_ATTACHMENT', id);
			return {
				schemaVersion: 1,
				workspaceId: dto.workspaceId,
				item: attachmentView(item)
			};
		});
	}
	async prepare(a: MailAuthority, id: string, dto: MailPrepareAttachmentDto) {
		this.enabled();
		if (!this.config.attachmentsAvailable)
			throw new ServiceUnavailableException({
				code: 'crm_mail_objects_not_configured'
			});
		const file = await this.attachment(a, id);
		if (file.messageId !== dto.messageId) throw new BadRequestException();
		return this.command(
			a,
			dto,
			'PREPARE_ATTACHMENT',
			this.hash(a, 'PREPARE_ATTACHMENT', [id, dto]),
			async (tx) => {
				const current = await this.attachment(a, id, tx);
				if (
					!['VALIDATED', 'QUARANTINED', 'REJECTED', 'UNAVAILABLE'].includes(
						current.state
					)
				) {
					const m = await this.mailbox(a, current.mailboxId, 'read', tx);
					if (!m.enabled)
						throw new ConflictException({ code: 'crm_mail_disconnected' });
					await this.enqueue(tx, m, 'FETCH_ATTACHMENT', id);
				}
				return {
					schemaVersion: 1,
					workspaceId: dto.workspaceId,
					item: attachmentView(current)
				};
			}
		);
	}
	async replySource(
		a: MailAuthority,
		mailboxId: string,
		contactId: string | null,
		id: string | null,
		tx: MailTx = this.prisma
	) {
		if (!id) return null;
		const imported = await tx.mailMessage.findFirst({
			where: { workspaceId: a.customer.workspaceId, id }
		});
		if (imported) {
			const source = await this.readableMessage(a, id, tx);
			if (source.mailboxId !== mailboxId) throw new BadRequestException();
			const linked = await tx.mailContactLink.findMany({
				where: {
					workspaceId: source.workspaceId,
					messageId: source.id,
					state: 'LINKED'
				}
			});
			if (
				contactId === null
					? linked.length > 0
					: !linked.some((link) => link.contactId === contactId)
			)
				throw new BadRequestException({
					code: 'crm_mail_reply_contact_invalid'
				});
			if (contactId) await this.contact(a, contactId, tx);
			return contactId === null ? source.id : null;
		} else {
			const source = await this.readableIntent(a, id, tx);
			if (source.mailboxId !== mailboxId || source.contactId !== contactId)
				throw new BadRequestException();
			if (contactId === null && source.scopeMessageId) {
				const linked = await tx.mailContactLink.findFirst({
					where: {
						workspaceId: source.workspaceId,
						messageId: source.scopeMessageId,
						state: 'LINKED'
					}
				});
				if (linked)
					throw new BadRequestException({
						code: 'crm_mail_reply_contact_invalid'
					});
			}
			return contactId === null ? source.scopeMessageId : null;
		}
	}
	async sendAttachment(
		a: MailAuthority,
		id: string,
		mailboxId: string,
		contactId: string | null,
		tx: MailTx = this.prisma,
		sendId?: string
	) {
		const file = await this.attachment(a, id, tx);
		if (file.mailboxId !== mailboxId) throw new BadRequestException();
		if (
			contactId === null &&
			(file.messageId ||
				file.uploadActor !== a.customer.subject ||
				file.uploadMembershipId !== a.membershipId)
		)
			throw new BadRequestException({
				code: 'crm_mail_attachment_context_invalid'
			});
		if (contactId === null) {
			const bindings = await tx.mailSendAttachment.findMany({
				where: { workspaceId: file.workspaceId, attachmentId: file.id }
			});
			if (bindings.some((binding) => binding.sendId !== sendId))
				throw new BadRequestException({
					code: 'crm_mail_attachment_context_invalid'
				});
		}
		if (file.messageId) {
			await this.replySource(a, mailboxId, contactId, file.messageId, tx);
		} else if (file.contactId !== contactId)
			throw new BadRequestException({
				code: 'crm_mail_attachment_context_invalid'
			});
		return file;
	}

	async send(a: MailAuthority, dto: MailSendDto) {
		this.enabled();
		if (!this.config.sendEnabled || !this.config.attachmentsAvailable)
			throw new ServiceUnavailableException({
				code: 'crm_mail_send_not_configured'
			});
		await this.mailbox(a, dto.mailboxId, 'send');
		if (dto.contactId) await this.contact(a, dto.contactId);
		const all = [...dto.to, ...dto.cc, ...dto.bcc];
		if (
			!dto.to.length ||
			all.length > 20 ||
			Buffer.byteLength(dto.text, 'utf8') > 24576 ||
			dto.attachmentIds.length > 10 ||
			new Set(dto.attachmentIds).size !== dto.attachmentIds.length ||
			/[\x00-\x1f\x7f]/.test(dto.subject) ||
			all.some(
				(v) =>
					/[\x00-\x20\x7f]/.test(v.email) ||
					(v.name !== null && /[\x00-\x1f\x7f]/.test(v.name))
			)
		)
			throw new BadRequestException({ code: 'crm_mail_compose_invalid' });
		return this.command(
			a,
			dto,
			'SEND',
			this.hash(a, 'SEND', dto),
			async (tx) => {
				const m = await this.lockMailbox(a, dto.mailboxId, 'send', tx);
				if (dto.contactId) await this.contact(a, dto.contactId, tx);
				if (!m.enabled)
					throw new ConflictException({ code: 'crm_mail_disconnected' });
				if (Buffer.byteLength(JSON.stringify(dto), 'utf8') > 32768)
					throw new BadRequestException({ code: 'crm_mail_compose_invalid' });
				const body = prepareMailBody(dto);
				let total = 0;
				for (const id of dto.attachmentIds) {
					const file = await this.sendAttachment(
						a,
						id,
						m.id,
						dto.contactId,
						tx
					);
					if (
						file.mailboxId !== m.id ||
						file.state !== 'VALIDATED' ||
						(file.contactId && file.contactId !== dto.contactId)
					)
						throw new BadRequestException({
							code: 'crm_mail_attachment_not_validated'
						});
					total += file.byteSize;
				}
				if (total > MAIL_LIMITS.maxSendBytes)
					throw new BadRequestException({ code: 'crm_mail_send_too_large' });
				const scopeMessageId = await this.replySource(
					a,
					m.id,
					dto.contactId,
					dto.replyToMessageId,
					tx
				);
				const intent = await tx.mailSendIntent.create({
					data: {
						workspaceId: dto.workspaceId,
						mailboxId: m.id,
						contactId: dto.contactId,
						scopeMessageId,
						actorSubject: a.customer.subject,
						membershipId: a.membershipId,
						commandId: dto.commandId,
						requestHash: this.hash(a, 'SEND', dto),
						mailboxGeneration: m.generation,
						to: dto.to as unknown as Prisma.InputJsonValue,
						cc: dto.cc as unknown as Prisma.InputJsonValue,
						bcc: dto.bcc as unknown as Prisma.InputJsonValue,
						subject: dto.subject,
						text: body.text,
						html: body.html,
						replyToMessageId: dto.replyToMessageId,
						attachmentIds: dto.attachmentIds,
						messageId: `<${randomUUID()}@${m.canonicalAddress.split('@')[1]}>`,
						state: 'QUEUED'
					}
				});
				for (const attachmentId of intent.attachmentIds)
					await tx.mailSendAttachment.create({
						data: {
							workspaceId: dto.workspaceId,
							sendId: intent.id,
							attachmentId
						}
					});
				await this.enqueue(tx, m, 'SEND', intent.id);
				return {
					schemaVersion: 1,
					workspaceId: dto.workspaceId,
					sendId: intent.id,
					state: 'QUEUED',
					messageId: intent.messageId
				};
			}
		);
	}
	async sendStatus(a: MailAuthority, id: string) {
		const s = await this.readableIntent(a, id);
		return {
			schemaVersion: 1,
			workspaceId: s.workspaceId,
			item: {
				id: s.id,
				state: s.state,
				messageId: s.messageId,
				accepted: s.accepted,
				rejected: s.rejected,
				safeErrorCode: s.safeErrorCode,
				createdAt: s.createdAt.toISOString(),
				settledAt: s.settledAt?.toISOString() || null
			}
		};
	}
	async buildMime(a: MailAuthority, s: MailSendIntent, m: MailMailbox) {
		const scopeMessageId = await this.replySource(
			a,
			m.id,
			s.contactId,
			s.replyToMessageId
		);
		if (scopeMessageId !== s.scopeMessageId)
			throw new BadRequestException({ code: 'crm_mail_reply_scope_invalid' });
		const attachments = [];
		for (const id of s.attachmentIds) {
			const file = await this.sendAttachment(
				a,
				id,
				m.id,
				s.contactId,
				this.prisma,
				s.id
			);
			if (file.state !== 'VALIDATED' || !file.privateObjectKey || !file.sha256)
				throw new Error('MAIL_ATTACHMENT_NOT_VALIDATED');
			this.objects.assertKey(file.privateObjectKey, m.workspaceId, m.id);
			const bytes = await this.objects.get(file.privateObjectKey);
			if (bytes.length !== file.byteSize || digest(bytes) !== file.sha256)
				throw new Error('MAIL_ATTACHMENT_INTEGRITY');
			attachments.push({
				filename: file.safeFileName,
				content: bytes,
				contentType: file.detectedMime || file.declaredMime
			});
		}
		let inReplyTo: string | undefined;
		let references: string[] = [];
		if (s.replyToMessageId) {
			const imported = await this.prisma.mailMessage.findFirst({
				where: { workspaceId: s.workspaceId, id: s.replyToMessageId }
			});
			if (imported) {
				await this.readableMessage(a, imported.id);
				inReplyTo = imported.messageId || undefined;
				references = [
					...imported.references,
					...(inReplyTo ? [inReplyTo] : [])
				].slice(-30);
			} else {
				const parent = await this.readableIntent(a, s.replyToMessageId);
				inReplyTo = parent.messageId;
				references = [parent.messageId];
			}
		}
		return this.transport.mime(m, {
			to: recipientList(addressList(s.to)),
			cc: recipientList(addressList(s.cc)),
			bcc: recipientList(addressList(s.bcc)),
			subject: s.subject,
			text: s.text,
			...(s.html !== null ? { html: s.html } : {}),
			messageId: s.messageId,
			inReplyTo,
			references,
			attachments
		});
	}
}
