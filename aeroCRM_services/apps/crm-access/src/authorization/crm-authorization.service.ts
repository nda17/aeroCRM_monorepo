import {
	ForbiddenException,
	Injectable,
	ServiceUnavailableException
} from '@nestjs/common';
import {
	CrmAccessLifecycle,
	type Prisma
} from '@prisma/crm-access-client';
import { getCrmAccessCorrelationId } from '../common/crm-access-request-context';
import { BillingEntitlementClient } from '../internal/billing-entitlement.client';
import {
	IdentityAuthContextClient,
	type CrmWorkspaceMembership
} from '../internal/identity-auth-context.client';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';

export type CrmRole =
	| 'OWNER'
	| 'CRM_ADMIN'
	| 'TEAM_LEAD'
	| 'MANAGER'
	| 'ANALYST'
	| 'CUSTOM';
export type CrmCaller = 'crm-customers' | 'crm-sales' | 'crm-intake';

const READ_PERMISSIONS = [
	'customers:read',
	'sales:read',
	'intake:read',
	'sales:analytics'
] as const;
const WRITE_PERMISSIONS = [
	'customers:write',
	'sales:write',
	'intake:write'
] as const;
const ADMIN_PERMISSIONS = [
	'customers:merge',
	'sales:manage-pipelines',
	'intake:manage-sources',
	'access:manage-team'
] as const;
const OWNER_PERMISSIONS = [
	'customers:export',
	'sales:export',
	'intake:export'
] as const;

@Injectable()
export class CrmAuthorizationService {
	constructor(
		private readonly identity: IdentityAuthContextClient,
		private readonly billing: BillingEntitlementClient,
		private readonly prisma: CrmAccessPrismaService
	) {}

	async authorize(
		authorization: string | undefined,
		workspaceId: string,
		caller?: CrmCaller,
		database?: Prisma.TransactionClient
	) {
		const correlationId = getCrmAccessCorrelationId();
		const identity = await this.identity.authContext(
			authorization,
			correlationId
		);
		const membership = identity.memberships.find(
			item => item.workspaceId === workspaceId
		);
		return this.resolve(
			workspaceId,
			identity.subject,
			membership,
			correlationId,
			caller,
			database
		);
	}

	async authorizeSource(workspaceId: string, subject: string) {
		const context = await this.authorizeSubject(
			workspaceId,
			subject,
			'crm-intake'
		);
		if (
			context.state === 'READ_ONLY' ||
			!['OWNER', 'CRM_ADMIN'].includes(context.role) ||
			!context.permissions.includes('intake:manage-sources')
		)
			throw new ForbiddenException('Source delegation is not active');
		return context;
	}

	async authorizeSubject(
		workspaceId: string,
		subject: string,
		caller?: CrmCaller
	) {
		const correlationId = getCrmAccessCorrelationId();
		const identity = await this.identity.sourceContext(
			workspaceId,
			subject,
			correlationId
		);
		return this.resolve(
			workspaceId,
			identity.subject,
			identity.membership,
			correlationId,
			caller
		);
	}

	async authorizeWorkflow(
		workspaceId: string,
		subject: string,
		purpose: string,
		caller: CrmCaller
	) {
		if (
			purpose !== 'INTAKE_ACCEPT' ||
			!['crm-intake', 'crm-customers', 'crm-sales'].includes(caller)
		)
			throw new ForbiddenException('Unsupported workflow authority');
		const context = await this.authorizeSubject(
			workspaceId,
			subject
		);
		const required = [
			'intake:read',
			'intake:write',
			'customers:read',
			'customers:write',
			'sales:read',
			'sales:write'
		];
		if (
			context.state === 'READ_ONLY' ||
			context.role === 'ANALYST' ||
			!required.every(permission =>
				context.permissions.includes(permission)
			)
		)
			throw new ForbiddenException('Workflow execution is not permitted');
		const namespace = caller.replace('crm-', '');
		return {
			...context,
			permissions: context.permissions.filter(permission =>
				permission.startsWith(`${namespace}:`)
			)
		};
	}

	// Keep the existing exact authorize DTO unchanged. Sales assignment alone
	// needs the current Identity membership binding, not a guessed CRM row ID.
	async assignmentSubject(
		workspaceId: string,
		subject: string,
		caller: CrmCaller = 'crm-sales'
	) {
		const correlationId = getCrmAccessCorrelationId();
		const identity = await this.identity.sourceContext(
			workspaceId,
			subject,
			correlationId
		);
		const context = await this.resolve(
			workspaceId,
			identity.subject,
			identity.membership,
			correlationId,
			caller
		);
		return { ...context, membershipId: identity.membership!.membershipId };
	}

	private async resolve(
		workspaceId: string,
		subject: string,
		membership: CrmWorkspaceMembership | null | undefined,
		correlationId: string,
		caller?: CrmCaller,
		database: Prisma.TransactionClient = this.prisma
	) {
		if (!membership)
			throw new ForbiddenException('Workspace membership is required');
		const [billing, workspace, member] = await Promise.all([
			this.billing.get(workspaceId, correlationId),
			database.crmWorkspaceAccess.findUnique({
				where: { workspaceId }
			}),
			membership.role === 'OWNER'
				? null
				: database.crmWorkspaceMember.findUnique({
						where: {
							workspaceId_subject: {
								workspaceId,
								subject
							}
						},
						include: {
							customRole: true,
							teams: {
								where: { team: { archivedAt: null } },
								select: { teamId: true },
								orderBy: { teamId: 'asc' }
							}
						}
					})
		]);
		if (
			!workspace ||
			!billing.entitlement ||
			workspace.billingEntitlementId !== billing.entitlement.id ||
			!workspace.onboardingCompletedAt ||
			![CrmAccessLifecycle.ACTIVE, CrmAccessLifecycle.READ_ONLY].includes(
				workspace.lifecycle as 'ACTIVE' | 'READ_ONLY'
			) ||
			!['ACTIVE', 'GRACE', 'READ_ONLY'].includes(billing.status)
		) {
			throw new ForbiddenException('aeroCRM workspace is not available');
		}
		if (
			membership.role !== 'OWNER' &&
			(!member ||
				member.disabledAt ||
				member.membershipId !== membership.membershipId)
		) {
			throw new ForbiddenException('An active CRM role is required');
		}
		const role: CrmRole =
			membership.role === 'OWNER' ? 'OWNER' : member!.role;
		const customRole = member?.customRole;
		if (
			role === 'CUSTOM' &&
			(!customRole ||
				customRole.archivedAt ||
				member!.customRoleId !== customRole.id)
		)
			throw new ForbiddenException('An active CRM role is required');
		// teamIds also bounds assignment in every domain service. Administrative
		// roles must use current, service-owned teams from this workspace, not an
		// absent OWNER member row or arbitrary team IDs supplied by the client.
		let teamIds = member?.teams.map(team => team.teamId) ?? [];
		if (
			role === 'OWNER' ||
			role === 'CRM_ADMIN' ||
			(role === 'CUSTOM' && customRole!.dataScope === 'ALL')
		) {
			const teams = await database.crmTeam.findMany({
				where: { workspaceId, archivedAt: null },
				select: { id: true },
				orderBy: { id: 'asc' },
				take: 1001
			});
			// Existing downstream contracts allow at most 1000 team IDs. Never
			// silently truncate authority or widen scope when that bound is reached.
			if (teams.length > 1000)
				throw new ServiceUnavailableException(
					'CRM team authority exceeds the supported contract limit'
				);
			teamIds = teams.map(team => team.id);
		}
		const state =
			workspace.lifecycle === CrmAccessLifecycle.READ_ONLY ||
			billing.status === 'READ_ONLY'
				? 'READ_ONLY'
				: (billing.status as 'ACTIVE' | 'GRACE');
		const canWrite = state !== 'READ_ONLY' && role !== 'ANALYST';
		let permissions: string[];
		if (role === 'CUSTOM') {
			permissions = customRole!.permissions.filter(
				permission => state !== 'READ_ONLY' || !permission.endsWith(':write')
			);
		} else {
			permissions =
				role === 'ANALYST' ? ['sales:analytics'] : [...READ_PERMISSIONS];
			if (canWrite) permissions.push(...WRITE_PERMISSIONS);
			if (canWrite && (role === 'OWNER' || role === 'CRM_ADMIN'))
				permissions.push(...ADMIN_PERMISSIONS);
			if (role === 'OWNER' || role === 'CRM_ADMIN') {
				permissions.push('access:read-team');
				if (canWrite) permissions.push('access:revoke-access');
			}
			if (role === 'OWNER') permissions.push(...OWNER_PERMISSIONS);
		}
		const namespace = caller?.replace('crm-', '');
		return {
			schemaVersion: 1 as const,
			workspaceId,
			subject,
			role,
			state,
			dataScope:
				role === 'CUSTOM'
					? (customRole!.dataScope as 'OWN' | 'TEAM' | 'ALL')
					: role === 'MANAGER'
					? ('OWN' as const)
					: role === 'TEAM_LEAD'
						? ('TEAM' as const)
						: ('ALL' as const),
			teamIds,
			permissions: (namespace
				? permissions.filter(permission =>
						permission.startsWith(`${namespace}:`)
					)
				: permissions
			).sort()
		};
	}
}
