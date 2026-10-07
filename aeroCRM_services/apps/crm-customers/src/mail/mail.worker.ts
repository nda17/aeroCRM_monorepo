import {
	ForbiddenException,
	NotFoundException,
	UnauthorizedException,
	Injectable,
	OnModuleDestroy,
	OnModuleInit
} from '@nestjs/common';
import {
	Prisma,
	MailJob,
	MailMailbox,
	MailConnection,
	MailAttachment
} from '@prisma/crm-customers-client';
import { randomUUID } from 'node:crypto';
import {
	ImapFlow,
	FetchMessageObject,
	MessageStructureObject,
	MessageAddressObject
} from 'imapflow';
import { simpleParser } from 'mailparser';
import { MailService, MailAddress, addressList } from './mail.service';
import {
	MailAuthority,
	MailAuthorityRevokedException
} from './mail-authorization.client';
import { mailRole, digest, MAIL_LIMITS } from './mail.config';
import {
	boundedBytes,
	safeMailFilename,
	validateMailBytes
} from './mail.objects';
import { customerScope } from '../customers/customers.service';
const BODY_LIMIT = 256 * 1024;
const cleanHeader = (value: string | undefined, max: number): string | null =>
	value && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
export function importedAddresses(
	value: MessageAddressObject[] | undefined
): MailAddress[] {
	return (value || [])
		.slice(0, 100)
		.filter(
			(a) =>
				a.address &&
				a.address.length <= 254 &&
				/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.address)
		)
		.map((a) => ({
			email: a.address!.trim().toLowerCase(),
			name: cleanHeader(a.name, 200)
		}));
}
export function flattenMailParts(
	root: MessageStructureObject | undefined
): MessageStructureObject[] {
	const result: MessageStructureObject[] = [];
	const visit = (node: MessageStructureObject, depth: number) => {
		if (depth > 10 || result.length >= 100)
			throw new Error('MAIL_MIME_STRUCTURE_LIMIT');
		result.push(node);
		for (const child of node.childNodes || []) visit(child, depth + 1);
	};
	if (root) visit(root, 0);
	return result;
}
@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
	private timer: NodeJS.Timeout | undefined;
	private stopping = false;
	private active = 0;
	private cleanupDue = 0;
	private cleanupCursor: string | undefined;
	private ticking = false;
	private readonly owner = randomUUID();
	private readonly role = mailRole();
	constructor(private readonly mail: MailService) {}
	onModuleInit() {
		if (
			this.role === 'api' ||
			!this.mail.config.enabled ||
			(this.role === 'mail-sync'
				? !this.mail.config.syncEnabled
				: !this.mail.config.sendEnabled)
		)
			return;
		this.timer = setInterval(
			() => void this.tick().catch(() => undefined),
			2000
		);
		this.timer.unref();
		void this.tick().catch(() => undefined);
	}
	async onModuleDestroy() {
		this.stopping = true;
		if (this.timer) clearInterval(this.timer);
		const deadline = Date.now() + 35000;
		while (this.active && Date.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 100));
	}
	private async recover() {
		await this.mail.prisma.$transaction(async (tx) => {
			const stale = await tx.mailJob.findMany({
				where: {
					state: 'RUNNING',
					leaseUntil: { lt: new Date() },
					...(this.role === 'mail-send'
						? { kind: 'SEND' }
						: { kind: { not: 'SEND' } })
				},
				take: 50
			});
			for (const job of stale) {
				const grabbed = await tx.mailJob.updateMany({
					where: {
						id: job.id,
						state: 'RUNNING',
						leaseVersion: job.leaseVersion,
						leaseUntil: { lt: new Date() }
					},
					data: { state: 'CANCELLED', leaseOwner: null, leaseUntil: null }
				});
				if (!grabbed.count) continue;
				if (job.kind === 'SEND' && job.targetId) {
					await tx.mailSendIntent.updateMany({
						where: {
							id: job.targetId,
							workspaceId: job.workspaceId,
							state: 'SENDING',
							dispatchAdmittedAt: { not: null }
						},
						data: {
							state: 'UNKNOWN',
							safeErrorCode: 'MAIL_DISPATCH_OUTCOME_UNKNOWN',
							settledAt: new Date(),
							version: { increment: 1 }
						}
					});
					const intent = await tx.mailSendIntent.findUnique({
						where: { id: job.targetId }
					});
					if (intent?.state !== 'QUEUED') continue;
				}
				const closed = await tx.workspaceClosureFence.findUnique({
					where: { workspaceId: job.workspaceId }
				});
				if (closed?.fencedAt) continue;
				await tx.mailJob.update({
					where: { id: job.id },
					data: {
						state: 'QUEUED',
						dueAt: new Date(),
						leaseVersion: { increment: 1 }
					}
				});
			}
		});
	}
	async tick() {
		if (this.stopping || this.ticking || this.active >= 2) return;
		this.ticking = true;
		try {
			await this.recover();
			if (
				this.role === 'mail-sync' &&
				this.mail.config.attachmentsAvailable &&
				Date.now() > this.cleanupDue
			) {
				this.cleanupDue = Date.now() + 60000;
				await this.cleanup().catch(() => undefined);
			}
			while (!this.stopping && this.active < 2) {
				const job = await this.claim();
				if (!job) break;
				this.active++;
				void this.run(job).finally(() => {
					this.active--;
				});
			}
		} finally {
			this.ticking = false;
		}
	}
	async cleanup() {
		const candidates = await this.mail.objects.candidates(this.cleanupCursor);
		this.cleanupCursor = candidates.nextCursor;
		const old = Date.now() - 24 * 60 * 60 * 1000;
		for (const item of candidates.items) {
			if (item.createdAt.getTime() > old) continue;
			const match =
				/^mail\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(?:mime-)?([0-9a-f-]{36})$/.exec(
					item.key
				);
			if (!match) continue;
			const [, workspaceId, mailboxId] = match;
			const removable = await this.mail.prisma.$transaction(async (tx) => {
				await tx.$queryRaw`SELECT id FROM crm_customers.mail_mailboxes WHERE workspace_id=${workspaceId}::uuid AND id=${mailboxId}::uuid FOR UPDATE`;
				const intent = await tx.mailSendIntent.findFirst({
					where: { workspaceId, mailboxId, mimeObjectKey: item.key },
					select: { id: true }
				});
				if (intent) return false;
				const file = await tx.mailAttachment.findFirst({
					where: { workspaceId, mailboxId, privateObjectKey: item.key }
				});
				if (!file) return true;
				if (
					!file.uploadActor ||
					!file.expiresAt ||
					file.expiresAt.getTime() > Date.now()
				)
					return false;
				const bound = await tx.mailSendAttachment.findFirst({
					where: { workspaceId, attachmentId: file.id }
				});
				if (bound) return false;
				if (file.state !== 'UNAVAILABLE')
					await tx.mailAttachment.update({
						where: { id: file.id },
						data: { state: 'UNAVAILABLE' }
					});
				return true;
			});
			if (removable) {
				this.mail.objects.assertKey(item.key, workspaceId, mailboxId);
				await this.mail.objects.remove(item.key);
			}
		}
	}

	private async claim(): Promise<MailJob | null> {
		const kinds =
			this.role === 'mail-send'
				? ['SEND']
				: ['LIVE_SYNC', 'FETCH_ATTACHMENT', 'VALIDATE_ATTACHMENT', 'BACKFILL'];
		return this.mail.prisma.$transaction(async (tx) => {
			const mailboxes = await tx.$queryRaw<
				Array<{ id: string; workspaceId: string }>
			>(Prisma.sql`
 SELECT m.id,m.workspace_id AS "workspaceId" FROM crm_customers.mail_mailboxes m LEFT JOIN crm_customers.workspace_closure_fences f ON f.workspace_id=m.workspace_id
 WHERE m.enabled AND f.fenced_at IS NULL
 AND EXISTS(SELECT 1 FROM crm_customers.mail_jobs j WHERE j.mailbox_id=m.id AND j.workspace_id=m.workspace_id AND j.generation=m.generation AND j.state='QUEUED' AND j.due_at<=clock_timestamp() AND j.kind IN (${Prisma.join(kinds)}))
 AND NOT EXISTS(SELECT 1 FROM crm_customers.mail_jobs r WHERE r.mailbox_id=m.id AND r.workspace_id=m.workspace_id AND r.state='RUNNING' AND r.lease_until>clock_timestamp())
 ORDER BY m.id LIMIT 1`);
			if (!mailboxes.length) return null;
			await tx.$executeRaw`SELECT crm_customers.assert_workspace_open(${mailboxes[0].workspaceId}::uuid)`;
			const locked = await tx.$queryRaw<
				Array<{ id: string }>
			>`SELECT m.id FROM crm_customers.mail_mailboxes m WHERE m.id=${mailboxes[0].id}::uuid AND m.enabled AND NOT EXISTS(SELECT 1 FROM crm_customers.mail_jobs j WHERE j.workspace_id=m.workspace_id AND j.mailbox_id=m.id AND j.state='RUNNING' AND j.lease_until>clock_timestamp()) FOR UPDATE OF m SKIP LOCKED`;
			if (!locked.length) return null;

			const jobs = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
 SELECT j.id FROM crm_customers.mail_jobs j JOIN crm_customers.mail_mailboxes m ON(m.id,m.workspace_id)=(j.mailbox_id,j.workspace_id)
 WHERE j.mailbox_id=${mailboxes[0].id}::uuid AND j.state='QUEUED' AND j.due_at<=clock_timestamp() AND j.generation=m.generation AND j.kind IN (${Prisma.join(kinds)})
 ORDER BY CASE j.kind WHEN 'LIVE_SYNC' THEN 0 WHEN 'SEND' THEN 0 WHEN 'BACKFILL' THEN 2 ELSE 1 END,j.due_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
			if (!jobs.length) return null;
			return tx.mailJob.update({
				where: { id: jobs[0].id },
				data: {
					state: 'RUNNING',
					leaseOwner: this.owner,
					leaseUntil: new Date(Date.now() + 120000),
					leaseVersion: { increment: 1 },
					attempts: { increment: 1 }
				}
			});
		});
	}
	private async fresh(
		job: MailJob,
		purpose: 'MAIL_SYNC' | 'MAIL_SEND'
	): Promise<{ a: MailAuthority; m: MailMailbox; c: MailConnection }> {
		const m = await this.mail.prisma.mailMailbox.findUniqueOrThrow({
			where: { id: job.mailboxId }
		});
		if (
			!m.enabled ||
			m.generation !== job.generation ||
			m.workspaceId !== job.workspaceId
		)
			throw new Error('MAIL_GENERATION_CHANGED');
		const c = await this.mail.prisma.mailConnection.findUniqueOrThrow({
			where: { id: m.connectionId }
		});
		const a = await this.mail.authorization.workflow(
			job.workspaceId,
			c.delegatedSubject,
			c.delegatedMembershipId,
			'MAIL_SYNC'
		);
		if (!a.mailPermissions.includes('mail:read'))
			throw new MailAuthorityRevokedException('MAIL_READ_REVOKED');
		await this.mail.mailbox(a, m.id, 'read');
		if (a.customer.state === 'READ_ONLY')
			throw new Error('MAIL_WORKSPACE_READ_ONLY');
		if (m.safeErrorCode === 'MAIL_WORKSPACE_READ_ONLY')
			await this.transitionPause(job, false, c.delegatedSubject);
		if (
			purpose === 'MAIL_SEND' &&
			(!this.mail.config.sendEnabled || !this.mail.config.attachmentsAvailable)
		)
			throw new Error('MAIL_SEND_DISABLED');
		return { a, m, c };
	}
	private async assertLease(job: MailJob, tx: Prisma.TransactionClient) {
		await tx.$executeRaw`SELECT crm_customers.assert_workspace_open(${job.workspaceId}::uuid)`;
		const rows = await tx.$queryRaw<
			Array<{ id: string }>
		>`SELECT id FROM crm_customers.mail_jobs WHERE id=${job.id}::uuid AND state='RUNNING' AND lease_owner=${this.owner}::uuid AND lease_version=${job.leaseVersion} AND lease_until>clock_timestamp() FOR UPDATE`;
		if (!rows.length) throw new Error('MAIL_LEASE_LOST');
	}
	private async finish(
		job: MailJob,
		state: 'DONE' | 'FAILED' | 'CANCELLED',
		error: string | null = null
	) {
		await this.mail.prisma.mailJob.updateMany({
			where: {
				id: job.id,
				state: 'RUNNING',
				leaseOwner: this.owner,
				leaseVersion: job.leaseVersion
			},
			data: { state, safeErrorCode: error, leaseOwner: null, leaseUntil: null }
		});
	}
	private async reschedule(
		job: MailJob,
		delay: number,
		error: string | null = null
	) {
		await this.mail.prisma.mailJob.updateMany({
			where: {
				id: job.id,
				state: 'RUNNING',
				leaseOwner: this.owner,
				leaseVersion: job.leaseVersion
			},
			data: {
				state: 'QUEUED',
				attempts: error
					? job.kind === 'LIVE_SYNC'
						? Math.min(job.attempts, 5)
						: undefined
					: 0,
				dueAt: new Date(Date.now() + delay),
				safeErrorCode: error,
				leaseOwner: null,
				leaseUntil: null
			}
		});
	}
	private async run(job: MailJob) {
		const heartbeat = setInterval(() => {
			void this.mail.prisma.mailJob
				.updateMany({
					where: {
						id: job.id,
						state: 'RUNNING',
						leaseOwner: this.owner,
						leaseVersion: job.leaseVersion
					},
					data: { leaseUntil: new Date(Date.now() + 120000) }
				})
				.catch(() => undefined);
		}, 30000);
		heartbeat.unref();
		try {
			if (job.kind === 'SEND') await this.send(job);
			else if (job.kind === 'VALIDATE_ATTACHMENT') await this.validate(job);
			else if (job.kind === 'FETCH_ATTACHMENT') await this.fetchAttachment(job);
			else await this.sync(job);
		} catch (error) {
			const safe =
				error instanceof MailAuthorityRevokedException
					? 'MAIL_AUTHORITY_REVOKED'
					: error instanceof Error && /^MAIL_[A-Z_]+$/.test(error.message)
						? error.message
						: 'MAIL_PROVIDER_UNAVAILABLE';
			try {
				if (safe === 'MAIL_UPLOAD_ACTOR_REVOKED') {
					await this.mail.prisma.mailAttachment.updateMany({
						where: {
							workspaceId: job.workspaceId,
							id: job.targetId!,
							state: 'QUARANTINED'
						},
						data: { state: 'UNAVAILABLE' }
					});
					await this.finish(job, 'CANCELLED', safe);
					return;
				}
				if (error instanceof MailAuthorityRevokedException) {
					await this.revoke(job, error.reason);
					return;
				}
				if (safe === 'MAIL_WORKSPACE_READ_ONLY' && job.kind !== 'SEND') {
					await this.transitionPause(job, true);
					return;
				}
				try {
					if (safe !== 'MAIL_WORKSPACE_READ_ONLY')
						await this.mail.prisma.mailMailbox.updateMany({
							where: {
								id: job.mailboxId,
								workspaceId: job.workspaceId,
								generation: job.generation,
								OR: [
									{ safeErrorCode: null },
									{ safeErrorCode: { not: 'MAIL_WORKSPACE_READ_ONLY' } }
								]
							},
							data: { safeErrorCode: safe }
						});
				} catch {
					/* closure prevents new diagnostics writes */
				}
				if (job.kind === 'SEND') {
					const intent = job.targetId
						? await this.mail.prisma.mailSendIntent.findUnique({
								where: { id: job.targetId }
							})
						: null;
					if (intent?.state === 'SENDING')
						await this.mail.prisma.mailSendIntent.updateMany({
							where: { id: intent.id, state: 'SENDING' },
							data: {
								state: 'UNKNOWN',
								safeErrorCode: 'MAIL_DISPATCH_OUTCOME_UNKNOWN',
								settledAt: new Date(),
								version: { increment: 1 }
							}
						});
					else if (intent?.state === 'QUEUED')
						await this.mail.prisma.mailSendIntent.updateMany({
							where: {
								id: intent.id,
								state: 'QUEUED',
								dispatchAdmittedAt: null
							},
							data: {
								state: 'FAILED',
								safeErrorCode: safe,
								settledAt: new Date(),
								version: { increment: 1 }
							}
						});
					await this.finish(job, 'FAILED', safe);
				} else if (job.kind === 'LIVE_SYNC' || job.attempts < 5) {
					await this.reschedule(
						job,
						Math.min(300000, 30000 * 2 ** (job.attempts - 1)),
						safe
					);
				} else await this.finish(job, 'FAILED', safe);
			} catch {
				/* SQL fence or lost lease: recovery settles the durable job. */
			}
		} finally {
			clearInterval(heartbeat);
		}
	}
	private async transitionPause(
		job: MailJob,
		paused: boolean,
		subject?: string
	) {
		await this.mail.prisma.$transaction(async (tx) => {
			await this.assertLease(job, tx);
			await tx.$queryRaw`SELECT id FROM crm_customers.mail_mailboxes WHERE workspace_id=${job.workspaceId}::uuid AND id=${job.mailboxId}::uuid FOR UPDATE`;
			const m = await tx.mailMailbox.findFirst({
				where: {
					id: job.mailboxId,
					workspaceId: job.workspaceId,
					generation: job.generation,
					enabled: true
				}
			});
			if (!m) throw new Error('MAIL_GENERATION_CHANGED');
			const changed = paused
				? m.safeErrorCode !== 'MAIL_WORKSPACE_READ_ONLY'
				: m.safeErrorCode === 'MAIL_WORKSPACE_READ_ONLY';
			if (changed) {
				const c = await tx.mailConnection.findUniqueOrThrow({
					where: { id: m.connectionId }
				});
				await tx.mailMailbox.update({
					where: { id: m.id },
					data: { safeErrorCode: paused ? 'MAIL_WORKSPACE_READ_ONLY' : null }
				});
				await tx.mailAudit.create({
					data: {
						workspaceId: job.workspaceId,
						mailboxId: m.id,
						actorSubject: subject || c.delegatedSubject,
						action: paused ? 'SYNC_PAUSED' : 'SYNC_RESUMED',
						entityId: m.id,
						metadata: {
							reason: 'MAIL_WORKSPACE_READ_ONLY',
							generation: job.generation
						}
					}
				});
			}
			if (paused)
				await tx.mailJob.update({
					where: { id: job.id },
					data: {
						state: 'QUEUED',
						attempts: 0,
						dueAt: new Date(Date.now() + 60000),
						safeErrorCode: 'MAIL_WORKSPACE_READ_ONLY',
						leaseOwner: null,
						leaseUntil: null
					}
				});
		});
	}
	private async revoke(job: MailJob, reason = 'MAIL_AUTHORITY_REVOKED') {
		await this.mail.prisma.$transaction(async (tx) => {
			await this.assertLease(job, tx);
			await tx.$queryRaw`SELECT id FROM crm_customers.mail_mailboxes WHERE workspace_id=${job.workspaceId}::uuid AND id=${job.mailboxId}::uuid FOR UPDATE`;
			const m = await tx.mailMailbox.findFirst({
				where: {
					id: job.mailboxId,
					workspaceId: job.workspaceId,
					generation: job.generation,
					enabled: true
				}
			});
			if (!m) return;
			const c = await tx.mailConnection.findFirst({
				where: {
					id: m.connectionId,
					workspaceId: job.workspaceId,
					state: 'ACTIVE'
				}
			});
			if (!c) return;
			await tx.mailAudit.create({
				data: {
					workspaceId: job.workspaceId,
					mailboxId: m.id,
					actorSubject: c.delegatedSubject,
					action: 'AUTHORITY_REVOKED',
					entityId: m.id,
					metadata: {
						reason,
						generation: job.generation
					}
				}
			});
			await tx.mailConnection.update({
				where: { id: m.connectionId },
				data: {
					state: 'REAUTH_REQUIRED',
					encryptedSecret: null,
					generation: { increment: 1 },
					version: { increment: 1 }
				}
			});
			await tx.mailMailbox.update({
				where: { id: m.id },
				data: {
					enabled: false,
					disconnectedAt: new Date(),
					generation: { increment: 1 },
					version: { increment: 1 },
					safeErrorCode: 'MAIL_AUTHORITY_REVOKED'
				}
			});
			await this.mail.cancelUnadmittedJobs(tx, job.workspaceId, m.id);
			await tx.mailSendIntent.updateMany({
				where: {
					workspaceId: job.workspaceId,
					mailboxId: m.id,
					state: 'QUEUED',
					dispatchAdmittedAt: null
				},
				data: {
					state: 'CANCELLED',
					safeErrorCode: 'MAIL_AUTHORITY_REVOKED',
					settledAt: new Date(),
					version: { increment: 1 }
				}
			});
		});
	}
	private async sync(job: MailJob) {
		const { m, c } = await this.fresh(job, 'MAIL_SYNC');
		let { a } = await this.fresh(job, 'MAIL_SYNC');
		if (!job.targetId) throw new Error('MAIL_FOLDER_MISSING');
		let folder = await this.mail.prisma.mailFolder.findFirst({
			where: {
				workspaceId: job.workspaceId,
				id: job.targetId,
				mailboxId: m.id,
				selected: true
			}
		});
		if (!folder) {
			await this.finish(job, 'CANCELLED');
			return;
		}
		const creds = this.mail.transport.credentials(c);
		const connection = this.mail.transport.configuration(c);
		const client = await this.mail.transport.imap(
			connection.imap,
			creds.password
		);
		try {
			const opened = await client.mailboxOpen(folder.exactPath, {
				readOnly: true
			});
			const upper = Math.max(0, opened.uidNext - 1);
			if (folder.uidValidity !== opened.uidValidity) {
				const now = new Date();
				const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
				const expected = folder.uidValidity;
				a = (await this.fresh(job, 'MAIL_SYNC')).a;
				folder = await this.mail.prisma.$transaction(async (tx) => {
					await this.assertLease(job, tx);
					const current = await tx.mailFolder.findUniqueOrThrow({
						where: { id: folder!.id }
					});
					if (current.uidValidity !== expected)
						throw new Error('MAIL_CURSOR_CHANGED');
					const reset = await tx.mailFolder.update({
						where: { id: current.id },
						data: {
							uidValidity: opened.uidValidity,
							generation: { increment: 1 },
							importStartedAt: now,
							cutoff,
							backfillUpperUid: BigInt(upper),
							backfillLastUid: 0n,
							liveLastUid: BigInt(upper),
							completedAt: null
						}
					});
					if (job.kind === 'LIVE_SYNC')
						await this.mail.enqueue(tx, m, 'BACKFILL', current.id);
					return reset;
				});
			}
			const live = job.kind === 'LIVE_SYNC';
			if (!live && folder.completedAt) {
				await this.finish(job, 'DONE');
				return;
			}
			const last = live
				? Number(folder.liveLastUid)
				: Number(folder.backfillLastUid);
			const max = live ? upper : Number(folder.backfillUpperUid || 0n);
			if (last >= max) {
				if (!live)
					await this.mail.prisma.mailFolder.update({
						where: { id: folder.id },
						data: { completedAt: new Date() }
					});
				if (live) await this.reschedule(job, 30000);
				else await this.finish(job, 'DONE');
				return;
			}
			// Scan bounded UID windows; SEARCH returns at most one window, never the whole 90-day mailbox.
			const windowEnd = Math.min(max, last + 500);
			const searched = await client.search(
				{ uid: `${last + 1}:${windowEnd}`, since: folder.cutoff! },
				{ uid: true }
			);
			const uids = (Array.isArray(searched) ? searched : [])
				.filter((uid) => uid > last && uid <= windowEnd)
				.sort((x, y) => x - y)
				.slice(0, 50);
			const cursor = uids.length === 50 ? uids[49] : windowEnd;
			const copies: Awaited<ReturnType<MailWorker['materialize']>>[] = [];
			for (const uid of uids) {
				const metadata = await client.fetchOne(
					String(uid),
					{
						uid: true,
						envelope: true,
						bodyStructure: true,
						internalDate: true,
						size: true,
						headers: ['references']
					},
					{ uid: true }
				);
				if (!metadata) continue;
				const received = new Date(metadata.internalDate || 0);
				if (!Number.isFinite(received.getTime()) || received < folder.cutoff!)
					continue;
				copies.push(await this.materialize(client, metadata, received));
			}
			a = (await this.fresh(job, 'MAIL_SYNC')).a;
			await this.mail.prisma.$transaction(async (tx) => {
				await this.assertLease(job, tx);
				const current = await tx.mailFolder.findUniqueOrThrow({
					where: { id: folder!.id }
				});
				const currentMailbox = await this.mail.mailbox(a, m.id, 'read', tx);
				if (
					!current.selected ||
					current.uidValidity !== opened.uidValidity ||
					currentMailbox.generation !== job.generation ||
					(live ? current.liveLastUid : current.backfillLastUid) !==
						BigInt(last)
				)
					throw new Error('MAIL_CURSOR_CHANGED');
				for (const copy of copies) {
					const exists = await tx.mailMessage.findUnique({
						where: {
							workspaceId_folderId_folderGeneration_uidValidity_uid: {
								workspaceId: job.workspaceId,
								folderId: folder!.id,
								folderGeneration: folder!.generation,
								uidValidity: opened.uidValidity,
								uid: BigInt(copy.uid)
							}
						}
					});
					if (exists) continue;
					const message = await tx.mailMessage.create({
						data: {
							workspaceId: job.workspaceId,
							mailboxId: m.id,
							folderId: folder!.id,
							folderGeneration: folder!.generation,
							uidValidity: opened.uidValidity,
							uid: BigInt(copy.uid),
							direction: folder!.kind === 'INBOX' ? 'INBOUND' : 'OUTBOUND',
							messageId: copy.messageId,
							inReplyTo: copy.inReplyTo,
							references: copy.references,
							from: copy.from as unknown as Prisma.InputJsonValue,
							to: copy.to as unknown as Prisma.InputJsonValue,
							cc: copy.cc as unknown as Prisma.InputJsonValue,
							bcc: copy.bcc as unknown as Prisma.InputJsonValue,
							subject: copy.subject,
							sentAt: copy.sentAt,
							receivedAt: copy.receivedAt,
							plainText: copy.text,
							bodyStatus: copy.bodyStatus,
							sourceHash: copy.sourceHash
						}
					});
					const external =
						folder!.kind === 'INBOX' ? copy.from : [...copy.to, ...copy.cc];
					for (const email of new Set(
						external
							.map((item) => item.email)
							.filter((email) => email !== m.canonicalAddress)
					)) {
						const exact = await tx.contact.findMany({
							where: { workspaceId: job.workspaceId, email, archivedAt: null },
							select: { id: true },
							take: 2
						});
						const anyVisible = await tx.contact.findFirst({
							where: { ...customerScope(a.customer), email },
							select: { id: true }
						});
						const candidate =
							exact.length === 1
								? await tx.contact.findFirst({
										where: { ...customerScope(a.customer), id: exact[0].id },
										select: { id: true }
									})
								: null;
						await tx.mailContactLink.create({
							data: {
								workspaceId: job.workspaceId,
								mailboxId: m.id,
								messageId: message.id,
								externalEmail: email,
								contactId: candidate?.id || null,
								state: candidate
									? 'LINKED'
									: exact.length > 1 && anyVisible
										? 'AMBIGUOUS'
										: 'UNMATCHED',
								method: 'EXACT',
								actorSubject: a.customer.subject
							}
						});
					}
					if (live && folder!.kind === 'INBOX')
						await tx.mailNotification.create({
							data: { workspaceId: job.workspaceId, messageId: message.id }
						});
					for (const part of copy.attachments)
						await tx.mailAttachment.create({
							data: {
								workspaceId: job.workspaceId,
								mailboxId: m.id,
								messageId: message.id,
								sourcePart: part.part,
								safeFileName: part.filename,
								declaredMime: part.type,
								byteSize: part.size,
								state: part.size > 7 * 1024 * 1024 ? 'UNAVAILABLE' : 'DEFERRED'
							}
						});
				}
				await tx.mailFolder.update({
					where: { id: folder!.id },
					data: live
						? { liveLastUid: BigInt(cursor) }
						: {
								backfillLastUid: BigInt(cursor),
								...(cursor >= max ? { completedAt: new Date() } : {})
							}
				});
				await tx.mailMailbox.update({
					where: { id: m.id },
					data: { lastSyncAt: new Date(), safeErrorCode: null }
				});
			});
			if (live) await this.reschedule(job, cursor < max ? 1000 : 30000);
			else if (cursor < max) await this.reschedule(job, 1000);
			else await this.finish(job, 'DONE');
		} finally {
			await client.logout().catch(() => client.close());
		}
	}
	private async materialize(
		client: ImapFlow,
		metadata: FetchMessageObject,
		receivedAt: Date
	) {
		const parts = flattenMailParts(metadata.bodyStructure);
		const attachmentParts = parts.filter(
			(part) =>
				part.part &&
				(part.disposition === 'attachment' ||
					part.dispositionParameters?.filename ||
					part.parameters?.name)
		);
		const attachments = attachmentParts.map((part) => ({
			part: part.part!,
			filename: safeMailFilename(
				part.dispositionParameters?.filename ||
					part.parameters?.name ||
					'attachment'
			),
			type: part.type.toLowerCase().slice(0, 200),
			size: Math.min(2147483647, Math.max(0, part.size || 0))
		}));
		const body =
			parts.find(
				(part) => part.type === 'text/plain' && !attachmentParts.includes(part)
			) ||
			parts.find(
				(part) => part.type === 'text/html' && !attachmentParts.includes(part)
			);
		let text: string | null = null;
		let bodyStatus = 'UNAVAILABLE';
		let sourceHash: string | null = null;
		if (body && (body.size || 0) <= BODY_LIMIT) {
			const download = await client.download(
				String(metadata.uid),
				body.part || '1',
				{ uid: true, maxBytes: BODY_LIMIT + 1 }
			);
			if (download.content) {
				const bytes = await boundedBytes(download.content, BODY_LIMIT + 1);
				if (bytes.length > BODY_LIMIT) bodyStatus = 'TOO_LARGE';
				else {
					const charset = /^[a-z0-9_-]{1,40}$/i.test(
						download.meta?.charset || ''
					)
						? download.meta?.charset
						: 'utf-8';
					const parsed = await simpleParser(
						Buffer.concat([
							Buffer.from(
								`Content-Type: ${body.type}; charset=${charset}\r\nContent-Transfer-Encoding: 8bit\r\n\r\n`
							),
							bytes
						]),
						{
							skipHtmlToText: false,
							skipTextToHtml: true,
							skipImageLinks: true
						}
					);
					const result = parsed.text || '';
					if (Buffer.byteLength(result) > BODY_LIMIT) bodyStatus = 'TOO_LARGE';
					else {
						text = result;
						bodyStatus = 'COMPLETE';
						sourceHash = digest(bytes);
					}
				}
			}
		} else if (body) bodyStatus = 'TOO_LARGE';
		const e = metadata.envelope;
		const sent = e?.date ? new Date(e.date) : null;
		return {
			uid: metadata.uid,
			messageId: cleanHeader(e?.messageId, 998),
			inReplyTo: cleanHeader(e?.inReplyTo, 998),
			references: [
				...(metadata.headers
					?.toString('utf8')
					.match(/<[^<>\s\x00-\x1f]{1,996}>/g) || [])
			].slice(0, 30),
			from: importedAddresses(e?.from),
			to: importedAddresses(e?.to),
			cc: importedAddresses(e?.cc),
			bcc: importedAddresses(e?.bcc),
			subject: (e?.subject || '')
				.replace(/[\x00-\x1f\x7f]/g, ' ')
				.slice(0, 300),
			sentAt: sent && Number.isFinite(sent.getTime()) ? sent : null,
			receivedAt,
			text,
			bodyStatus,
			sourceHash,
			attachments
		};
	}
	private async fetchAttachment(job: MailJob) {
		const { a, m, c } = await this.fresh(job, 'MAIL_SYNC');
		if (!job.targetId) throw new Error('MAIL_ATTACHMENT_MISSING');
		const file = await this.mail.prisma.mailAttachment.findUniqueOrThrow({
			where: { id: job.targetId }
		});
		if (file.state === 'VALIDATED' || file.state === 'QUARANTINED') {
			await this.finish(job, 'DONE');
			return;
		}
		if (!file.messageId || !file.sourcePart || file.mailboxId !== m.id)
			throw new Error('MAIL_ATTACHMENT_MISSING');
		await this.mail.readableMessage(a, file.messageId);
		const message = await this.mail.prisma.mailMessage.findUniqueOrThrow({
			where: { id: file.messageId }
		});
		const folder = await this.mail.prisma.mailFolder.findUniqueOrThrow({
			where: { id: message.folderId }
		});
		if (!folder.selected || folder.generation !== message.folderGeneration)
			throw new Error('MAIL_FOLDER_NOT_SELECTED');
		const creds = this.mail.transport.credentials(c);
		const transport = this.mail.transport.configuration(c);
		const client = await this.mail.transport.imap(
			transport.imap,
			creds.password
		);
		try {
			const opened = await client.mailboxOpen(folder.exactPath, {
				readOnly: true
			});
			if (opened.uidValidity !== message.uidValidity)
				throw new Error('MAIL_SOURCE_UNAVAILABLE');
			const download = await client.download(
				message.uid.toString(),
				file.sourcePart,
				{ uid: true, maxBytes: MAIL_LIMITS.maxFileBytes + 1 }
			);
			if (!download.content) throw new Error('MAIL_SOURCE_UNAVAILABLE');
			const bytes = await boundedBytes(
				download.content,
				MAIL_LIMITS.maxFileBytes
			);
			const key = this.mail.objects.key(
				file.workspaceId,
				file.mailboxId,
				randomUUID()
			);
			await this.mail.objects.put(key, bytes);
			const fresh = (await this.fresh(job, 'MAIL_SYNC')).a;
			await this.mail.readableMessage(fresh, message.id);
			await this.mail.prisma.$transaction(async (tx) => {
				await this.assertLease(job, tx);
				const current = await tx.mailAttachment.findUniqueOrThrow({
					where: { id: file.id }
				});
				if (current.state !== 'DEFERRED')
					throw new Error('MAIL_ATTACHMENT_STATE_CHANGED');
				await tx.mailAttachment.update({
					where: { id: file.id },
					data: {
						state: 'QUARANTINED',
						byteSize: bytes.length,
						sha256: digest(bytes),
						privateObjectKey: key
					}
				});
				await this.mail.enqueue(tx, m, 'VALIDATE_ATTACHMENT', file.id);
			});
			await this.finish(job, 'DONE');
		} finally {
			await client.logout().catch(() => client.close());
		}
	}
	private async validationAuthority(
		job: MailJob,
		file: MailAttachment,
		fallback: MailAuthority
	) {
		if (!file.uploadActor || !file.uploadMembershipId) {
			await this.mail.attachment(fallback, file.id);
			return fallback;
		}
		try {
			const actor = await this.mail.authorization.workflow(
				job.workspaceId,
				file.uploadActor,
				file.uploadMembershipId,
				'MAIL_SEND'
			);
			await this.mail.attachment(actor, file.id);
			return actor;
		} catch (error) {
			if (
				error instanceof ForbiddenException ||
				error instanceof NotFoundException ||
				error instanceof UnauthorizedException
			)
				throw new Error('MAIL_UPLOAD_ACTOR_REVOKED');
			throw error;
		}
	}
	private async validate(job: MailJob) {
		const { a, m } = await this.fresh(job, 'MAIL_SYNC');
		if (!job.targetId) throw new Error('MAIL_ATTACHMENT_MISSING');
		const file = await this.mail.prisma.mailAttachment.findUniqueOrThrow({
			where: { id: job.targetId }
		});
		if (file.state === 'VALIDATED' || file.state === 'REJECTED') {
			await this.finish(job, 'DONE');
			return;
		}
		if (
			file.state !== 'QUARANTINED' ||
			!file.privateObjectKey ||
			!file.sha256 ||
			file.mailboxId !== m.id
		)
			throw new Error('MAIL_ATTACHMENT_MISSING');
		await this.validationAuthority(job, file, a);
		this.mail.objects.assertKey(
			file.privateObjectKey,
			file.workspaceId,
			file.mailboxId
		);
		const bytes = await this.mail.objects.get(file.privateObjectKey);
		if (bytes.length !== file.byteSize || digest(bytes) !== file.sha256)
			throw new Error('MAIL_ATTACHMENT_INTEGRITY');
		let detectedMime: string | null = null;
		let state = 'VALIDATED';
		try {
			detectedMime = await validateMailBytes(
				bytes,
				file.safeFileName,
				file.declaredMime
			);
		} catch {
			state = 'REJECTED';
		}
		await this.validationAuthority(
			job,
			file,
			(await this.fresh(job, 'MAIL_SYNC')).a
		);
		await this.mail.prisma.$transaction(async (tx) => {
			await this.assertLease(job, tx);
			await tx.mailAttachment.updateMany({
				where: { id: file.id, state: 'QUARANTINED', sha256: file.sha256 },
				data: { state, detectedMime }
			});
		});
		await this.finish(job, 'DONE');
	}
	private async send(job: MailJob) {
		let { m, c } = await this.fresh(job, 'MAIL_SEND');
		if (!job.targetId) throw new Error('MAIL_SEND_MISSING');
		let intent = await this.mail.prisma.mailSendIntent.findUniqueOrThrow({
			where: { id: job.targetId }
		});
		if (intent.state !== 'QUEUED' || intent.dispatchAdmittedAt) {
			await this.finish(job, 'DONE');
			return;
		}
		let a = await this.mail.authorization.workflow(
			job.workspaceId,
			intent.actorSubject,
			intent.membershipId,
			'MAIL_SEND'
		);
		await this.mail.mailbox(a, m.id, 'send');
		if (intent.contactId) await this.mail.contact(a, intent.contactId);
		if (intent.mailboxGeneration !== m.generation)
			throw new Error('MAIL_GENERATION_CHANGED');
		let mime: Buffer;
		if (intent.mimeObjectKey && intent.mimeHash) {
			this.mail.objects.assertKey(
				intent.mimeObjectKey,
				intent.workspaceId,
				intent.mailboxId
			);
			mime = await this.mail.objects.get(
				intent.mimeObjectKey,
				16 * 1024 * 1024
			);
			if (digest(mime) !== intent.mimeHash)
				throw new Error('MAIL_MIME_INTEGRITY');
		} else {
			mime = await this.mail.buildMime(a, intent, m);
			if (mime.length > 16 * 1024 * 1024)
				throw new Error('MAIL_MIME_TOO_LARGE');
			const key = this.mail.objects.key(
				intent.workspaceId,
				intent.mailboxId,
				`mime-${randomUUID()}`
			);
			await this.mail.objects.put(key, mime);
			intent = await this.mail.prisma.$transaction(async (tx) => {
				await this.assertLease(job, tx);
				const current = await this.mail.lockMailbox(a, m.id, 'send', tx);
				if (current.generation !== job.generation)
					throw new Error('MAIL_GENERATION_CHANGED');
				const updated = await tx.mailSendIntent.updateMany({
					where: { id: intent.id, state: 'QUEUED', mimeHash: null },
					data: {
						mimeObjectKey: key,
						mimeHash: digest(mime),
						envelope: {
							from: m.canonicalAddress,
							to: [
								...addressList(intent.to),
								...addressList(intent.cc),
								...addressList(intent.bcc)
							].map((v) => v.email)
						},
						version: { increment: 1 }
					}
				});
				if (!updated.count) throw new Error('MAIL_SEND_STATE_CHANGED');
				return tx.mailSendIntent.findUniqueOrThrow({
					where: { id: intent.id }
				});
			});
		}
		const credentials = this.mail.transport.credentials(c);
		const configuration = this.mail.transport.configuration(c);
		const smtp = await this.mail.transport.smtp(
			configuration.smtp,
			credentials.smtpPassword
		);
		try {
			({ m, c } = await this.fresh(job, 'MAIL_SEND'));
			a = await this.mail.authorization.workflow(
				job.workspaceId,
				intent.actorSubject,
				intent.membershipId,
				'MAIL_SEND'
			);
			await this.mail.prisma.$transaction(async (tx) => {
				await this.assertLease(job, tx);
				const current = await this.mail.lockMailbox(a, m.id, 'send', tx);
				if (intent.contactId) await this.mail.contact(a, intent.contactId, tx);
				const scopeMessageId = await this.mail.replySource(
					a,
					m.id,
					intent.contactId,
					intent.replyToMessageId,
					tx
				);
				if (scopeMessageId !== intent.scopeMessageId)
					throw new Error('MAIL_REPLY_SCOPE_CHANGED');
				if (!current.enabled || current.generation !== intent.mailboxGeneration)
					throw new Error('MAIL_GENERATION_CHANGED');
				for (const id of intent.attachmentIds) {
					const attachment = await this.mail.sendAttachment(
						a,
						id,
						m.id,
						intent.contactId,
						tx,
						intent.id
					);
					if (attachment.state !== 'VALIDATED' || attachment.mailboxId !== m.id)
						throw new Error('MAIL_ATTACHMENT_NOT_VALIDATED');
				}
				const admitted = await tx.mailSendIntent.updateMany({
					where: {
						id: intent.id,
						state: 'QUEUED',
						dispatchAdmittedAt: null,
						mimeHash: digest(mime)
					},
					data: {
						state: 'SENDING',
						dispatchAdmittedAt: new Date(),
						version: { increment: 1 }
					}
				});
				if (!admitted.count) throw new Error('MAIL_SEND_ALREADY_ADMITTED');
			});
			try {
				const result = await smtp.sendMail({
					raw: mime,
					envelope: intent.envelope as { from: string; to: string[] }
				});
				const accepted = (result.accepted || []).map((value) => String(value));
				const rejected = (result.rejected || []).map((value) => String(value));
				const state = accepted.length
					? rejected.length
						? 'PARTIAL_ACCEPTED'
						: 'ACCEPTED'
					: 'FAILED';
				await this.mail.prisma.mailSendIntent.updateMany({
					where: { id: intent.id, state: 'SENDING' },
					data: {
						state,
						accepted,
						rejected,
						settledAt: new Date(),
						safeErrorCode: state === 'FAILED' ? 'MAIL_SMTP_REJECTED' : null,
						version: { increment: 1 }
					}
				});
			} catch (error) {
				const smtpError = error as {
					responseCode?: number;
					command?: string;
					code?: string;
				};
				const terminal = Boolean(
					smtpError.responseCode &&
					smtpError.responseCode >= 400 &&
					smtpError.responseCode <= 599 &&
					['RCPT TO', 'MAIL FROM', 'DATA'].includes(smtpError.command || '')
				);
				await this.mail.prisma.mailSendIntent.updateMany({
					where: { id: intent.id, state: 'SENDING' },
					data: {
						state: terminal ? 'FAILED' : 'UNKNOWN',
						safeErrorCode: terminal
							? 'MAIL_SMTP_REJECTED'
							: 'MAIL_DISPATCH_OUTCOME_UNKNOWN',
						settledAt: new Date(),
						version: { increment: 1 }
					}
				});
			}
			await this.finish(job, 'DONE');
		} finally {
			smtp.close();
		}
	}
}
