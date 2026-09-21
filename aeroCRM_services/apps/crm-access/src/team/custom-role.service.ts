import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma, type CrmCustomRole } from '@prisma/crm-access-client';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import type {
	CreateCustomRoleDto,
	UpdateCustomRoleDto
} from './custom-role.dto';
import type { TeamQueryDto, VersionedTeamCommandDto } from './team.dto';
import { auditTeam, command, type TeamAuthority } from './team.util';

export const CUSTOM_ROLE_PERMISSIONS = [
	'customers:read',
	'customers:write',
	'intake:read',
	'intake:write',
	'sales:read',
	'sales:write',
	'sales:analytics'
] as const;

type RoleCounts = { memberCount: number; invitationCount: number };
const RESERVED_ROLE_NAME_KEYS = new Set([
	'владелец',
	'руководительотдела',
	'менеджер',
	'аналитик'
]);

export function customRolesEnabled() {
	const value = process.env.CRM_ACCESS_CUSTOM_ROLES_ENABLED?.trim() || 'false';
	if (value !== 'true' && value !== 'false')
		throw new ServiceUnavailableException(
			'CRM custom role configuration is unavailable'
		);
	return value === 'true';
}

export function normalizeCustomRoleName(value: string) {
	const name = value.normalize('NFC').trim().replace(/ +/g, ' ');
	if (!/^[А-ЯЁ][А-Яа-яЁё0-9 -]{0,79}$/u.test(name))
		throw new BadRequestException({
			code: 'crm_role_name_invalid',
			message:
				'Название роли должно начинаться с заглавной русской буквы и содержать до 80 русских букв, цифр, пробелов или дефисов'
		});
	return { name, nameKey: name.toLocaleLowerCase('ru-RU').replaceAll(' ', '') };
}

export function normalizeCustomRolePermissions(value: string[]) {
	const permissions = [...value].sort();
	const allowed = new Set<string>(CUSTOM_ROLE_PERMISSIONS);
	const valid =
		permissions.length > 0 &&
		permissions.length <= CUSTOM_ROLE_PERMISSIONS.length &&
		new Set(permissions).size === permissions.length &&
		permissions.every(permission => allowed.has(permission)) &&
		(!permissions.includes('customers:write') ||
			permissions.includes('customers:read')) &&
		(!permissions.includes('intake:write') ||
			permissions.includes('intake:read')) &&
		(!permissions.includes('sales:write') ||
			permissions.includes('sales:read'));
	if (!valid)
		throw new BadRequestException({
			code: 'crm_role_permissions_invalid',
			message: 'Выбран недопустимый набор прав роли'
		});
	return permissions;
}

@Injectable()
export class CrmCustomRoleService {
	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly auth: CrmAuthorizationService
	) {}

	async list(authorization: string | undefined, query: TeamQueryDto) {
		const actor = await this.readAuthority(authorization, query.workspaceId);
		const where = { workspaceId: actor.workspaceId, archivedAt: null };
		const [items, total] = await this.prisma.$transaction([
			this.prisma.crmCustomRole.findMany({
				where,
				orderBy: [{ nameKey: 'asc' }, { id: 'asc' }],
				skip: (query.page - 1) * query.pageSize,
				take: query.pageSize
			}),
			this.prisma.crmCustomRole.count({ where })
		]);
		const counts = await this.counts(this.prisma, actor.workspaceId, items);
		return {
			schemaVersion: 1,
			workspaceId: actor.workspaceId,
			page: query.page,
			pageSize: query.pageSize,
			total,
			items: items.map(item => roleDto(item, counts.get(item.id)))
		};
	}

	async create(
		authorization: string | undefined,
		dto: CreateCustomRoleDto
	) {
		const actor = await this.writeAuthority(authorization, dto.workspaceId);
		const { name, nameKey } = normalizeCustomRoleName(dto.name);
		const permissions = normalizeCustomRolePermissions(dto.permissions);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'custom-role.create',
			{ ...dto, name, permissions },
			async tx => {
				await this.uniqueName(tx, dto.workspaceId, nameKey);
				const role = await tx.crmCustomRole.create({
					data: {
						workspaceId: dto.workspaceId,
						name,
						nameKey,
						permissions,
						dataScope: dto.dataScope
					}
				});
				await auditTeam(tx, actor, dto.commandId, 'CUSTOM_ROLE_CREATED', role.id, null, {
					name,
					permissions,
					dataScope: dto.dataScope,
					version: role.version
				});
				return { schemaVersion: 1, role: roleDto(role) };
			},
			tx => this.writeAuthorityAfterLock(authorization, actor, tx)
		);
	}

	async update(
		authorization: string | undefined,
		id: string,
		dto: UpdateCustomRoleDto
	) {
		const actor = await this.writeAuthority(authorization, dto.workspaceId);
		const { name, nameKey } = normalizeCustomRoleName(dto.name);
		const permissions = normalizeCustomRolePermissions(dto.permissions);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'custom-role.update',
			{ id, ...dto, name, permissions },
			async tx => {
				const current = await this.role(tx, id, dto.workspaceId);
				if (current.version !== dto.expectedVersion)
					throw this.versionConflict();
				await this.uniqueName(tx, dto.workspaceId, nameKey, id);
				const updated = await tx.crmCustomRole.update({
					where: { id },
					data: {
						name,
						nameKey,
						permissions,
						dataScope: dto.dataScope,
						version: { increment: 1 }
					}
				});
				await auditTeam(
					tx,
					actor,
					dto.commandId,
					'CUSTOM_ROLE_UPDATED',
					id,
					{
						name: current.name,
						permissions: current.permissions,
						dataScope: current.dataScope,
						version: current.version
					},
					{
						name,
						permissions,
						dataScope: dto.dataScope,
						version: updated.version
					}
				);
				const counts = await this.counts(tx, dto.workspaceId, [updated]);
				return {
					schemaVersion: 1,
					role: roleDto(updated, counts.get(updated.id))
				};
			},
			tx => this.writeAuthorityAfterLock(authorization, actor, tx)
		);
	}

	async archive(
		authorization: string | undefined,
		id: string,
		dto: VersionedTeamCommandDto
	) {
		const actor = await this.writeAuthority(authorization, dto.workspaceId);
		return command(
			this.prisma,
			actor,
			dto.commandId,
			'custom-role.archive',
			{ id, ...dto },
			async tx => {
				const current = await this.role(tx, id, dto.workspaceId);
				if (current.version !== dto.expectedVersion)
					throw this.versionConflict();
				const counts = await this.counts(tx, dto.workspaceId, [current]);
				const usage = counts.get(id) ?? { memberCount: 0, invitationCount: 0 };
				if (usage.memberCount || usage.invitationCount)
					throw new ConflictException({
						code: 'crm_role_in_use',
						message: 'Роль назначена сотрудникам или активным приглашениям'
					});
				const updated = await tx.crmCustomRole.update({
					where: { id },
					data: { archivedAt: new Date(), version: { increment: 1 } }
				});
				await auditTeam(
					tx,
					actor,
					dto.commandId,
					'CUSTOM_ROLE_ARCHIVED',
					id,
					{ archivedAt: null, version: current.version },
					{ archivedAt: updated.archivedAt, version: updated.version }
				);
				return {
					schemaVersion: 1,
					role: roleDto(updated, usage)
				};
			},
			tx => this.writeAuthorityAfterLock(authorization, actor, tx)
		);
	}

	async requireActive(
		tx: Prisma.TransactionClient | CrmAccessPrismaService,
		workspaceId: string,
		id: string,
		expectedVersion?: number
	) {
		const role = await tx.crmCustomRole.findFirst({
			where: { id, workspaceId }
		});
		if (!role) throw new NotFoundException('CRM custom role not found');
		if (role.archivedAt)
			throw new ConflictException({
				code: 'crm_role_unavailable',
				message: 'Роль больше недоступна'
			});
		if (expectedVersion !== undefined && role.version !== expectedVersion)
			throw this.versionConflict();
		return role;
	}

	private async readAuthority(
		authorization: string | undefined,
		workspaceId: string
	) {
		const actor = await this.auth.authorize(authorization, workspaceId);
		if (
			!['OWNER', 'CRM_ADMIN'].includes(actor.role) ||
			!actor.permissions.includes('access:read-team')
		)
			throw new ForbiddenException('CRM role catalog is not permitted');
		return actor;
	}

	private async writeAuthority(
		authorization: string | undefined,
		workspaceId: string
	): Promise<TeamAuthority> {
		const actor = await this.auth.authorize(authorization, workspaceId);
		if (actor.role !== 'OWNER' || actor.state === 'READ_ONLY')
			throw new ForbiddenException('Only the owner can manage custom roles');
		if (!customRolesEnabled())
			throw new ServiceUnavailableException({
				code: 'crm_custom_roles_disabled',
				message: 'Настраиваемые роли временно недоступны'
			});
		return actor;
	}

	private async writeAuthorityAfterLock(
		authorization: string | undefined,
		expected: TeamAuthority,
		tx: Prisma.TransactionClient
	) {
		const actor = await this.auth.authorize(
			authorization,
			expected.workspaceId,
			undefined,
			tx
		);
		if (
			actor.subject !== expected.subject ||
			actor.role !== 'OWNER' ||
			actor.state === 'READ_ONLY'
		)
			throw new ForbiddenException(
				'Custom role authority changed; retry the command'
			);
		if (!customRolesEnabled())
			throw new ServiceUnavailableException({
				code: 'crm_custom_roles_disabled',
				message: 'Настраиваемые роли временно недоступны'
			});
	}

	private async role(
		tx: Prisma.TransactionClient,
		id: string,
		workspaceId: string
	) {
		const role = await tx.crmCustomRole.findFirst({
			where: { id, workspaceId, archivedAt: null }
		});
		if (!role) throw new NotFoundException('CRM custom role not found');
		return role;
	}

	private async uniqueName(
		tx: Prisma.TransactionClient,
		workspaceId: string,
		nameKey: string,
		id?: string
	) {
		if (RESERVED_ROLE_NAME_KEYS.has(nameKey))
			throw new ConflictException({
				code: 'crm_role_name_conflict',
				message: 'Название встроенной роли зарезервировано'
			});
		if (
			await tx.crmCustomRole.findFirst({
				where: {
					workspaceId,
					nameKey,
					archivedAt: null,
					...(id ? { id: { not: id } } : {})
				}
			})
		)
			throw new ConflictException({
				code: 'crm_role_name_conflict',
				message: 'Роль с таким названием уже существует'
			});
	}

	private versionConflict() {
		return new ConflictException({
			code: 'crm_role_version_conflict',
			message: 'Роль была изменена, обновите данные'
		});
	}

	private async counts(
		tx: Prisma.TransactionClient | CrmAccessPrismaService,
		workspaceId: string,
		roles: CrmCustomRole[]
	) {
		const result = new Map<string, RoleCounts>();
		await Promise.all(
			roles.map(async role => {
				const [memberCount, invitations] = await Promise.all([
					tx.crmWorkspaceMember.count({
						where: { workspaceId, customRoleId: role.id }
					}),
					tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
						SELECT count(DISTINCT invitation.id)::bigint AS count
						FROM crm_access.crm_invitation_intents invitation
						LEFT JOIN crm_access.crm_admissions admission
						  ON admission.intent_id = invitation.id AND admission.status = 'WAITING'
						WHERE invitation.workspace_id = ${workspaceId}::uuid
						  AND invitation.custom_role_id = ${role.id}::uuid
						  AND (((invitation.status IN ('REGISTERING','INVITED')) AND invitation.expires_at > now())
						       OR admission.id IS NOT NULL)
					`)
				]);
				result.set(role.id, {
					memberCount,
					invitationCount: Number(invitations[0]?.count ?? 0n)
				});
			})
		);
		return result;
	}
}

export const roleDto = (role: CrmCustomRole, counts?: RoleCounts) => ({
	id: role.id,
	workspaceId: role.workspaceId,
	name: role.name,
	permissions: [...role.permissions].sort(),
	dataScope: role.dataScope,
	version: role.version,
	archivedAt: role.archivedAt?.toISOString() ?? null,
	createdAt: role.createdAt.toISOString(),
	updatedAt: role.updatedAt.toISOString(),
	memberCount: counts?.memberCount ?? 0,
	invitationCount: counts?.invitationCount ?? 0
});
