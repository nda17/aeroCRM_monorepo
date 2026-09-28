import { MailConfig, mailRole } from '../mail/mail.config';
import {
	Injectable,
	Optional,
	ServiceUnavailableException
} from '@nestjs/common';
import { CrmCustomersPrismaService } from '../prisma/crm-customers-prisma.service';

const SERVICE_NAME =
	mailRole() === 'api' ? 'crm-customers' : `crm-customers-${mailRole()}`;
const DATABASE_SERVICE_NAME = 'crm-customers-service';

@Injectable()
export class CrmCustomersHealthService {
	constructor(
		private readonly prisma: CrmCustomersPrismaService,
		@Optional() private readonly mailConfig?: MailConfig
	) {}

	liveness() {
		return {
			status: 'ok',
			service: SERVICE_NAME,
			revision: process.env.APP_REVISION || 'unknown'
		};
	}

	revision() {
		return {
			service: SERVICE_NAME,
			revision: process.env.APP_REVISION || 'unknown'
		};
	}

	async readiness() {
		try {
			await this.prisma.$queryRaw`SELECT 1`;
			void this.mailConfig?.enabled;
			await this.prisma
				.$queryRaw`SELECT m.id,g.id,f.id,l.id,a.id,c.command_id,s.send_id,d.id FROM crm_customers.mail_mailboxes m CROSS JOIN crm_customers.mail_mailbox_grants g CROSS JOIN crm_customers.mail_folders f CROSS JOIN crm_customers.mail_contact_links l CROSS JOIN crm_customers.mail_attachments a CROSS JOIN crm_customers.mail_commands c CROSS JOIN crm_customers.mail_send_attachments s CROSS JOIN crm_customers.mail_audit d LIMIT 0`;

			await this.prisma
				.$queryRaw`SELECT id, workspace_id, transport, encrypted_secret, generation FROM crm_customers.mail_connections LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT id, workspace_id, state, dispatch_admitted_at, mime_hash FROM crm_customers.mail_send_intents LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT id, workspace_id, state, lease_version, lease_until FROM crm_customers.mail_jobs LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT id, workspace_id, actor_subject, entity, format, row_count, byte_count, snapshot_at, prepared_at FROM crm_customers.export_audit LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT operation_id, workspace_id, workflow_id, actor_subject, payload_hash, state, contact_id, result, committed_at FROM crm_customers.intake_operation_slots LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT command_id, workspace_id, actor_subject, request_hash, result FROM crm_customers.intake_operation_commands LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT c.id, c.workspace_id, c.name, c.phone, c.email, c.company_id, c.time_zone, c.preferred_call_start, c.preferred_call_end, c.notes, c.created_by_subject, c.team_id, c.version, c.archived_at, c.created_at, c.updated_at FROM crm_customers.contacts c LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT c.id, c.workspace_id, c.name, c.inn, c.website, c.legal_name, c.kpp, c.ogrn, c.legal_address, c.entity_type, c.notes, c.created_by_subject, c.team_id, c.version, c.archived_at, c.created_at, c.updated_at FROM crm_customers.companies c LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT command_id, workspace_id, entity_id, entity_kind, actor_subject, request_hash, response, created_at FROM crm_customers.customer_commands LIMIT 0`;
			await this.prisma
				.$queryRaw`SELECT id, workspace_id, entity_id, entity_kind, command_id, actor_subject, action, entity_version, changed_fields, created_at FROM crm_customers.customer_activities LIMIT 0`;
			const identity = await this.prisma.serviceIdentity.findUnique({
				where: { id: 'singleton' },
				select: { serviceName: true, databaseId: true }
			});
			if (
				identity?.serviceName !== DATABASE_SERVICE_NAME ||
				!identity.databaseId
			) {
				throw new Error('Invalid service identity');
			}
		} catch {
			throw new ServiceUnavailableException(
				'CRM Customers database is not ready'
			);
		}

		return {
			status: 'ready',
			service: SERVICE_NAME,
			revision: process.env.APP_REVISION || 'unknown'
		};
	}
}
