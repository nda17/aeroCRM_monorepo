import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-intake-client';
import { createHash } from 'node:crypto';
import {
	assertIntakePermission,
	IntakeAuthorization,
	IntakeAuthorizationClient
} from '../access/intake-authorization.client';
import { intakeEntryScope } from '../intake/intake.service';
import { CrmIntakePrismaService } from '../prisma/crm-intake-prisma.service';
import { MailIntakeCreateDto } from './mail-intake.dto';
import { MailSourceClient } from './mail-source.client';

@Injectable()
export class MailIntakeService {
	constructor(
		private readonly prisma: CrmIntakePrismaService,
		private readonly authorization: IntakeAuthorizationClient,
		private readonly mail: MailSourceClient
	) {}
	private async authority(
		bearer: string | undefined,
		workspaceId: string,
		write = false
	) {
		const context = await this.authorization.authorize(bearer, workspaceId);
		assertIntakePermission(context, 'intake:read');
		if (write) assertIntakePermission(context, 'intake:write', true);
		return context;
	}
	async preview(
		bearer: string | undefined,
		workspaceId: string,
		messageId: string
	) {
		const context = await this.authority(bearer, workspaceId);
		const source = await this.mail.source(
			bearer,
			workspaceId,
			messageId,
			context.subject
		);
		const sender = source.message.from[0];
		return {
			schemaVersion: 1,
			workspaceId,
			source: { messageId, sourceHash: source.message.sourceHash },
			draft: {
				title: source.message.subject.trim().slice(0, 200) || 'Письмо',
				name: (sender?.name?.trim() || sender?.email || 'Отправитель').slice(
					0,
					200
				),
				phone: null,
				email: sender?.email || null,
				message: source.message.text || null,
				teamId: null
			},
			bodyStatus: source.message.bodyStatus,
			textTruncated: source.message.textTruncated
		};
	}

	async create(bearer: string | undefined, dto: MailIntakeCreateDto) {
		const payload = {
			messageId: dto.messageId,
			sourceHash: dto.sourceHash,
			title: dto.title.trim(),
			name: dto.name.trim(),
			phone: dto.phone ?? null,
			email: dto.email?.trim().toLowerCase() || null,
			message: dto.message?.trim() || null,
			teamId: dto.teamId ?? null,
			copyConfirmed: dto.copyConfirmed
		};
		if (!payload.title || !payload.name || payload.copyConfirmed !== true)
			throw new BadRequestException({
				code: 'crm_intake_mail_copy_confirmation_required'
			});
		for (let attempt = 0; attempt < 3; attempt++) {
			const context = await this.authority(bearer, dto.workspaceId, true);
			if (
				payload.teamId &&
				(context.dataScope === 'OWN' ||
					!context.teamIds.includes(payload.teamId))
			)
				throw new ForbiddenException({ code: 'crm_intake_team_denied' });
			const source = await this.mail.source(
				bearer,
				dto.workspaceId,
				dto.messageId,
				context.subject
			);
			const fresh = await this.authority(bearer, dto.workspaceId, true);
			if (JSON.stringify(fresh) !== JSON.stringify(context))
				throw new ForbiddenException({ code: 'crm_intake_authority_changed' });
			if (source.message.sourceHash !== dto.sourceHash)
				throw new ConflictException({ code: 'crm_intake_mail_source_changed' });
			const hash = createHash('sha256')
				.update(
					JSON.stringify({
						schemaVersion: 1,
						workspaceId: dto.workspaceId,
						actor: context.subject,
						membershipId: source.membershipId,
						operation: 'mail-copy',
						payload
					})
				)
				.digest('hex');
			try {
				return await this.prisma.$transaction(
					async (tx) => {
						await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-intake:command:${dto.commandId}`}, 0))`;
						const receipt = await tx.intakeCommand.findUnique({
							where: { commandId: dto.commandId }
						});
						if (receipt) {
							if (
								receipt.workspaceId !== dto.workspaceId ||
								receipt.actorSubject !== context.subject ||
								receipt.entityKind !== 'entry' ||
								receipt.requestHash !== hash
							)
								throw new ConflictException({
									code: 'crm_intake_command_conflict'
								});
							await this.entry(tx, context, receipt.entityId);
							return receipt.response;
						}
						await tx.$executeRaw`SELECT crm_intake.assert_workspace_open(${dto.workspaceId}::uuid)`;
						await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-intake:mail-copy:${dto.workspaceId}:${dto.messageId}`}, 0))`;
						const existing = await tx.mailIntakeSource.findUnique({
							where: {
								workspaceId_messageId: {
									workspaceId: dto.workspaceId,
									messageId: dto.messageId
								}
							}
						});
						let entryId: string;
						if (existing) {
							const visible = await tx.inboxEntry.findFirst({
								where: {
									AND: [intakeEntryScope(context), { id: existing.entryId }]
								},
								select: { id: true }
							});
							if (!visible)
								throw new ConflictException({
									code: 'crm_intake_mail_already_copied'
								});
							entryId = visible.id;
						} else {
							const entry = await tx.inboxEntry.create({
								data: {
									workspaceId: dto.workspaceId,
									createdBySubject: context.subject,
									origin: 'MANUAL',
									title: payload.title,
									name: payload.name,
									phone: payload.phone,
									email: payload.email,
									message: payload.message,
									teamId: payload.teamId
								}
							});
							entryId = entry.id;
							await tx.mailIntakeSource.create({
								data: {
									workspaceId: dto.workspaceId,
									entryId,
									messageId: dto.messageId,
									mailboxId: source.message.mailboxId,
									actorMembershipId: source.membershipId,
									actorSubject: context.subject,
									commandId: dto.commandId,
									sourceHash: source.message.sourceHash
								}
							});
							await tx.intakeActivity.create({
								data: {
									workspaceId: dto.workspaceId,
									entityId: entryId,
									entityKind: 'entry',
									commandId: dto.commandId,
									actorSubject: context.subject,
									action: 'CREATED',
									entityVersion: entry.version
								}
							});
						}
						const response = {
							schemaVersion: 1,
							sourceKind: 'MAIL',
							workspaceId: dto.workspaceId,
							entryId
						};
						await tx.intakeCommand.create({
							data: {
								commandId: dto.commandId,
								workspaceId: dto.workspaceId,
								entityId: entryId,
								entityKind: 'entry',
								actorSubject: context.subject,
								requestHash: hash,
								response
							}
						});
						return response;
					},
					{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
				);
			} catch (error) {
				if (String(error).includes('crm_workspace_closed'))
					throw new ForbiddenException({ code: 'crm_workspace_closed' });
				if (
					!(error instanceof Prisma.PrismaClientKnownRequestError) ||
					!(
						error.code === 'P2034' ||
						error.code === 'P2002' ||
						(error.code === 'P2010' &&
							['40001', '40P01'].includes(String(error.meta?.code)))
					)
				)
					throw error;
				if (attempt === 2)
					throw new ServiceUnavailableException({
						code: 'crm_intake_retry_required'
					});
			}
		}
		throw new ServiceUnavailableException({
			code: 'crm_intake_retry_required'
		});
	}

	async command(
		bearer: string | undefined,
		workspaceId: string,
		commandId: string
	) {
		const context = await this.authority(bearer, workspaceId);
		const receipt = await this.prisma.intakeCommand.findFirst({
			where: {
				commandId,
				workspaceId,
				actorSubject: context.subject
			}
		});
		if (!receipt)
			return { schemaVersion: 1, workspaceId, status: 'ABSENT', entryId: null };
		const response = receipt.response;
		if (
			receipt.entityKind !== 'entry' ||
			!response ||
			typeof response !== 'object' ||
			Array.isArray(response) ||
			Object.keys(response).sort().join(',') !==
				'entryId,schemaVersion,sourceKind,workspaceId' ||
			response.schemaVersion !== 1 ||
			response.sourceKind !== 'MAIL' ||
			response.workspaceId !== workspaceId ||
			response.entryId !== receipt.entityId
		)
			throw new ConflictException({ code: 'crm_intake_command_conflict' });
		await this.entry(this.prisma, context, receipt.entityId);
		return {
			schemaVersion: 1,
			workspaceId,
			status: 'COMMITTED',
			entryId: receipt.entityId
		};
	}

	async source(
		bearer: string | undefined,
		workspaceId: string,
		entryId: string
	) {
		const context = await this.authority(bearer, workspaceId);
		await this.entry(this.prisma, context, entryId);
		const source = await this.prisma.mailIntakeSource.findFirst({
			where: { workspaceId, entryId }
		});
		if (!source)
			throw new NotFoundException({ code: 'crm_intake_mail_source_not_found' });
		try {
			await this.mail.source(
				bearer,
				workspaceId,
				source.messageId,
				context.subject
			);
			return {
				schemaVersion: 1,
				workspaceId,
				entryId,
				source: { kind: 'MAIL', canOpen: true, messageId: source.messageId }
			};
		} catch (error) {
			if (
				!(
					error instanceof ForbiddenException ||
					error instanceof NotFoundException
				)
			)
				throw error;
			return {
				schemaVersion: 1,
				workspaceId,
				entryId,
				source: { kind: 'MAIL', canOpen: false, messageId: null }
			};
		}
	}
	private async entry(
		tx: Prisma.TransactionClient,
		context: IntakeAuthorization,
		id: string
	) {
		const entry = await tx.inboxEntry.findFirst({
			where: { AND: [intakeEntryScope(context), { id }] },
			select: { id: true }
		});
		if (!entry)
			throw new NotFoundException({ code: 'crm_intake_entry_not_found' });
		return entry;
	}
}
