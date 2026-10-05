import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import type { CrmDirectoryEntry, Prisma } from '@prisma/crm-access-client';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { auditTeam, command, type TeamAuthority } from '../team/team.util';
import { normalizeEmployeeName } from '../team/team-profile.dto';
import { collaborationSignal } from './directory.util';
import type {
	DirectoryQueryDto,
	UpdateDirectoryDto,
	DirectoryCommandDto
} from './directory.dto';

export const directoryFields = (row: CrmDirectoryEntry) => ({
	firstName: row.firstName,
	lastName: row.lastName,
	middleName: row.middleName,
	phone: row.phone,
	email: row.email,
	position: row.position,
	department: row.department,
	extension: row.extension,
	telegram: row.telegram
});
export const directoryName = (
	row: CrmDirectoryEntry | null,
	fallback: string
) =>
	row
		? [row.lastName, row.firstName, row.middleName]
				.filter(Boolean)
				.join(' ') ||
			row.email ||
			fallback
		: fallback;

@Injectable()
export class DirectoryService {
	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly auth: CrmAuthorizationService
	) {}
	async list(token: string | undefined, query: DirectoryQueryDto) {
		const actor = await this.auth.authorize(token, query.workspaceId);
		const where: Prisma.CrmDirectoryEntryWhereInput = {
			workspaceId: query.workspaceId,
			...(!query.includeArchived ? { archivedAt: null } : {}),
			...(query.q
				? {
						OR: [
							'firstName',
							'lastName',
							'middleName',
							'email',
							'phone',
							'position',
							'department'
						].map(field => ({
							[field]: { contains: query.q, mode: 'insensitive' }
						}))
					}
				: {})
		};
		if (query.activeOnly) {
			const [workspace, members] = await Promise.all([
				this.prisma.crmWorkspaceAccess.findUniqueOrThrow({
					where: { workspaceId: actor.workspaceId }
				}),
				this.prisma.crmWorkspaceMember.findMany({
					where: { workspaceId: actor.workspaceId, disabledAt: null },
					select: { subject: true }
				})
			]);
			where.subject = {
				in: [
					workspace.activatedBySubject,
					...members.map(member => member.subject)
				]
			};
		}
		const [total, rows] = await this.prisma.$transaction([
			this.prisma.crmDirectoryEntry.count({ where }),
			this.prisma.crmDirectoryEntry.findMany({
				where,
				orderBy: [
					{ lastName: 'asc' },
					{ firstName: 'asc' },
					{ id: 'asc' }
				],
				skip: (query.page - 1) * query.pageSize,
				take: query.pageSize
			})
		]);
		const entries = await Promise.all(
			rows.map(row => this.entry(actor, row))
		);
		return {
			schemaVersion: 1,
			workspaceId: actor.workspaceId,
			subject: actor.subject,
			page: query.page,
			pageSize: query.pageSize,
			total,
			items: query.activeOnly
				? entries.filter(row => row.status === 'ACTIVE')
				: entries
		};
	}
	async update(
		token: string | undefined,
		id: string,
		dto: UpdateDirectoryDto
	) {
		const actor = await this.auth.authorize(token, dto.workspaceId);
		this.writable(actor);
		const fields = Object.fromEntries(
			Object.entries(dto.fields).map(([key, value]) => [
				key,
				typeof value === 'string' ? value.trim() || null : value
			])
		) as typeof dto.fields;
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'directory.update',
			{ ...dto, fields, id },
			async tx => {
				const row = await this.current(tx, actor, id, dto.expectedVersion);
				const normalized = normalizeEmployeeName({
					firstName: fields.firstName ?? 'Сотрудник',
					lastName: fields.lastName ?? 'Сотрудник',
					middleName: fields.middleName
				});
				const names = {
					firstName:
						fields.firstName === null ? null : normalized.firstName,
					lastName: fields.lastName === null ? null : normalized.lastName,
					middleName: normalized.middleName
				};
				const profile = row.subject
					? await tx.crmEmployeeProfile.findUnique({
							where: {
								workspaceId_subject: {
									workspaceId: actor.workspaceId,
									subject: row.subject
								}
							}
						})
					: null;
				if (profile && (!names.firstName || !names.lastName))
					throw new BadRequestException(
						'An existing employee profile requires first and last name'
					);
				const updated = await tx.crmDirectoryEntry.update({
					where: { id },
					data: { ...fields, ...names, version: { increment: 1 } }
				});
				if (updated.subject && names.firstName && names.lastName) {
					await tx.crmEmployeeProfile.upsert({
						where: {
							workspaceId_subject: {
								workspaceId: actor.workspaceId,
								subject: updated.subject
							}
						},
						create: {
							workspaceId: actor.workspaceId,
							subject: updated.subject,
							firstName: names.firstName,
							lastName: names.lastName,
							middleName: names.middleName
						},
						update: {
							firstName: names.firstName,
							lastName: names.lastName,
							middleName: names.middleName,
							version: { increment: 1 }
						}
					});
				}
				await auditTeam(
					tx,
					actor,
					dto.commandId,
					'DIRECTORY_UPDATED',
					id,
					{ version: row.version },
					{ version: updated.version }
				);
				await collaborationSignal(tx, actor.workspaceId);
				return this.response(actor, updated);
			},
			async tx => {
				const fresh = await this.auth.authorize(
					token,
					dto.workspaceId,
					undefined,
					tx
				);
				this.writable(fresh);
			}
		);
	}
	async archive(
		token: string | undefined,
		id: string,
		dto: DirectoryCommandDto,
		archived: boolean
	) {
		const actor = await this.auth.authorize(token, dto.workspaceId);
		this.writable(actor);
		if (actor.role !== 'OWNER')
			throw new ForbiddenException(
				'Only owner can archive directory cards'
			);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			archived ? 'directory.archive' : 'directory.restore',
			{ ...dto, id },
			async tx => {
				const row = await this.current(tx, actor, id, dto.expectedVersion);
				const updated = await tx.crmDirectoryEntry.update({
					where: { id },
					data: {
						archivedAt: archived ? new Date() : null,
						version: { increment: 1 }
					}
				});
				await auditTeam(
					tx,
					actor,
					dto.commandId,
					archived ? 'DIRECTORY_ARCHIVED' : 'DIRECTORY_RESTORED',
					id,
					{ version: row.version },
					{ version: updated.version }
				);
				await collaborationSignal(tx, actor.workspaceId);
				return this.response(actor, updated);
			},
			async tx => {
				const fresh = await this.auth.authorize(
					token,
					dto.workspaceId,
					undefined,
					tx
				);
				this.writable(fresh);
				if (fresh.role !== 'OWNER') throw new ForbiddenException();
			}
		);
	}
	private writable(actor: TeamAuthority) {
		if (actor.state === 'READ_ONLY')
			throw new ForbiddenException('Directory is read-only');
	}
	private async current(
		tx: Prisma.TransactionClient,
		actor: TeamAuthority,
		id: string,
		version: number
	) {
		const row = await tx.crmDirectoryEntry.findFirst({
			where: { id, workspaceId: actor.workspaceId }
		});
		if (!row) throw new NotFoundException('Directory card was not found');
		if (row.version !== version)
			throw new ConflictException('Directory version changed');
		return row;
	}
	private async response(actor: TeamAuthority, row: CrmDirectoryEntry) {
		return {
			schemaVersion: 1,
			workspaceId: actor.workspaceId,
			subject: actor.subject,
			item: await this.entry(actor, row)
		};
	}
	async entry(actor: TeamAuthority, row: CrmDirectoryEntry) {
		const [workspace, member, invitation, admission] = await Promise.all([
			this.prisma.crmWorkspaceAccess.findUniqueOrThrow({
				where: { workspaceId: actor.workspaceId }
			}),
			row.subject
				? this.prisma.crmWorkspaceMember.findUnique({
						where: {
							workspaceId_subject: {
								workspaceId: actor.workspaceId,
								subject: row.subject
							}
						}
					})
				: null,
			row.invitationId
				? this.prisma.crmInvitationIntent.findFirst({
						where: { id: row.invitationId, workspaceId: actor.workspaceId }
					})
				: null,
			row.invitationId
				? this.prisma.crmAdmission.findUnique({
						where: { intentId: row.invitationId }
					})
				: null
		]);
		const isOwner = row.subject === workspace.activatedBySubject;
		let membershipId: string | null = null;
		let status =
			isOwner || (member && !member.disabledAt)
				? 'ACTIVE'
				: member
					? 'DISABLED'
					: admission?.status === 'WAITING'
						? 'WAITING'
						: invitation?.status === 'ACCEPTED'
							? 'DISABLED'
							: (invitation?.status ?? 'DISABLED');
		if (
			invitation &&
			['REGISTERING', 'INVITED'].includes(status) &&
			invitation.expiresAt <= new Date()
		)
			status = 'EXPIRED';
		if (row.subject && status === 'ACTIVE') {
			try {
				membershipId = (
					await this.auth.assignmentSubject(actor.workspaceId, row.subject)
				).membershipId;
			} catch (error) {
				if (error instanceof ForbiddenException) status = 'DISABLED';
				else throw error;
			}
		} else if (member) membershipId = member.membershipId;
		return {
			id: row.id,
			subject: row.subject,
			membershipId,
			invitationId: row.invitationId,
			status,
			isOwner,
			displayName: directoryName(row, 'Сотрудник'),
			fields: directoryFields(row),
			version: row.version,
			archivedAt: row.archivedAt?.toISOString() ?? null,
			updatedAt: row.updatedAt.toISOString(),
			canEdit: actor.state !== 'READ_ONLY',
			canArchive: actor.state !== 'READ_ONLY' && actor.role === 'OWNER',
			canMessage: status === 'ACTIVE' && row.subject !== actor.subject
		};
	}
}
