import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { CrmTeamRabbitService } from '../team/team-rabbit.service';
import { CrmTeamOutboxService } from '../team/team-outbox.service';

@Injectable()
export class CrmAccessHealthService {
	constructor(
		private readonly prisma: CrmAccessPrismaService,
		private readonly rabbit: CrmTeamRabbitService,
		private readonly outbox: CrmTeamOutboxService
	) {}

	liveness() {
		return this.status('ok');
	}

	async readiness() {
		try {
			await this.prisma.$queryRaw`SELECT 1`;
			const identity = await this.prisma.serviceIdentity.findUnique({
				where: { id: 'singleton' },
				select: {
					serviceName: true,
					databaseId: true,
					createdAt: true,
					updatedAt: true
				}
			});
			if (
				identity?.serviceName !== 'crm-access-service' ||
				!identity.databaseId
			) {
				throw new Error('Invalid database identity');
			}
			await this.prisma.crmWorkspaceAccess.findFirst({
				select: {
					lifecycle: true,
					billingEntitlementId: true,
					provisioningCommandId: true,
					provisioningCommandType: true,
					activatedBySubject: true,
					onboardingCommandId: true,
					onboardingTemplateKey: true,
					onboardingTemplateVersion: true,
					onboardingTemplateFingerprint: true,
					onboardingPipelineId: true,
					onboardingCompletedAt: true
				}
			});
			await this.prisma.crmWorkspaceMember.findFirst({
				select: {
					workspaceId: true,
					membershipId: true,
					role: true,
					customRoleId: true,
					customRole: {
						select: {
							name: true,
							permissions: true,
							dataScope: true,
							version: true,
							archivedAt: true
						}
					},
					teams: { select: { teamId: true } },
					disabledAt: true,
					version: true
				}
			});
			await this.prisma
				.$queryRaw`SELECT t.version, i.identity_version, i.custom_role_id, a.position, r.request_hash, h.command_id, o.lease_token, d.version FROM crm_access.crm_teams t FULL JOIN crm_access.crm_invitation_intents i ON false FULL JOIN crm_access.crm_admissions a ON false FULL JOIN crm_access.crm_team_command_receipts r ON false FULL JOIN crm_access.crm_team_audit h ON false FULL JOIN crm_access.crm_team_outbox o ON false FULL JOIN crm_access.crm_team_deliveries d ON false LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT c.revision, c.admission_ceiling, c.pending_operation_id, c.pending_target_seats, c.latest_committed_operation_id, o.state, o.request_hash, o.next_check_at, o.release_fence FROM crm_access.crm_billing_capacity c FULL JOIN crm_access.crm_billing_operations o ON false LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT workspace_id, display_name, version, updated_at FROM crm_access.crm_workspace_branding LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT e.version, c.last_sequence, p.read_through_sequence, m.sender_membership_id FROM crm_access.crm_directory_entries e FULL JOIN crm_access.crm_chat_conversations c ON false FULL JOIN crm_access.crm_chat_participants p ON false FULL JOIN crm_access.crm_chat_messages m ON false LIMIT 0`;
			const [collaboration] = await this.prisma.$queryRaw<
				{ enabled: boolean }[]
			>`
				SELECT count(*) = 13 AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
				WHERE n.nspname='crm_access' AND t.tgenabled IN ('O','A') AND (
				 (c.relname IN ('crm_directory_entries','crm_chat_conversations','crm_chat_participants','crm_chat_messages') AND t.tgname='workspace_closure_business_guard') OR
				 (c.relname IN ('crm_directory_entries','crm_chat_conversations','crm_chat_participants','crm_chat_messages','crm_workspace_members','crm_invitation_intents','crm_admissions') AND t.tgname='workspace_collaboration_signal') OR
				 (c.relname='crm_chat_messages' AND t.tgname='crm_chat_message_immutable') OR
				 (c.relname='crm_workspace_access' AND t.tgname='provision_workspace_collaboration'))`;
			if (!collaboration?.enabled)
				throw new Error('Workspace collaboration schema is not ready');
			const [customRoleContract] = await this.prisma.$queryRaw<
				{ allowed: boolean }[]
			>`SELECT crm_access.is_valid_custom_role_permissions(ARRAY['sales:read']::text[]) AS allowed`;
			if (!customRoleContract?.allowed)
				throw new Error('CRM custom role runtime is not ready');
			if (!this.rabbit.isReady() || !this.outbox.isReady())
				throw new Error('CRM team runtime is not ready');
			return {
				...this.status('ready'),
				database: {
					serviceName: identity.serviceName,
					databaseId: identity.databaseId,
					createdAt: identity.createdAt.toISOString(),
					updatedAt: identity.updatedAt.toISOString()
				}
			};
		} catch {
			throw new ServiceUnavailableException(
				'CRM Access database is not ready'
			);
		}
	}

	private status(status: 'ok' | 'ready') {
		return {
			status,
			service: 'crm-access',
			revision: process.env.APP_REVISION || 'unknown'
		};
	}
}
