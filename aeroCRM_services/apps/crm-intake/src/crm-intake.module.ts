import { InboxNotificationsController } from './notifications/inbox-notifications.controller';
import { InboxNotificationsService } from './notifications/inbox-notifications.service';
import { LiveChangesService } from './live/live-changes.service';
import { LiveChangesController } from './live/live-changes.controller';
import { Module } from '@nestjs/common';
import { IntakeExportController } from './exports/export.controller';
import { IntakeExportService } from './exports/export.service';
import { ConfigModule } from '@nestjs/config';
import { CrmIntakeHealthController } from './health/crm-intake-health.controller';
import { CrmIntakeHealthService } from './health/crm-intake-health.service';
import { CrmIntakePrismaModule } from './prisma/crm-intake-prisma.module';
import { IntakeAuthorizationClient } from './access/intake-authorization.client';
import { IntakeController } from './intake/intake.controller';
import { IntakeService } from './intake/intake.service';
import { IntakeCsvImportController } from './intake/intake-csv-import.controller';
import { IntakeCsvImportService } from './intake/intake-csv-import.service';
import { IntakeIngestionController } from './intake/intake-ingestion.controller';
import {
	IntakeIngestionRateLimiter,
	IntakeIngestionService
} from './intake/intake-ingestion.service';
import { AcceptanceController } from './acceptance/acceptance.controller';
import { AcceptanceService } from './acceptance/acceptance.service';
import { AcceptanceOperationsClient } from './acceptance/acceptance-operations.client';
import { AcceptanceProcessor } from './acceptance/acceptance.processor';
import {
	AcceptanceRabbit,
	intakeProcessRole
} from './acceptance/acceptance.messaging';
import { AcceptancePublisher } from './acceptance/acceptance.publisher';
import { AcceptanceWorker } from './acceptance/acceptance.worker';
import { intakeSlaEnabled } from './sla/sla.contract';
import { SlaController } from './sla/sla.controller';
import { SlaService } from './sla/sla.service';
import { SlaAuthorityClient } from './sla/sla-authority.client';
import { SlaRabbit } from './sla/sla.messaging';
import { SlaProcessor } from './sla/sla.processor';
import { SlaWorker } from './sla/sla.worker';
import { SlaPublisher } from './sla/sla.publisher';
import { SlaRecipientsClient } from './sla/sla-recipients.client';
import { SlaReadinessService } from './sla/sla-readiness.service';
import { SlaDeliveryService } from './sla/sla-delivery.service';
import {
	SlaDeliveryController,
	SlaDeliveryGuard
} from './sla/sla-delivery.controller';

const config = ConfigModule.forRoot({ isGlobal: true });
const role = intakeProcessRole();
const api = role === 'api' || role === 'all';
const worker = role === 'worker' || role === 'all';
const publisher = role === 'publisher' || role === 'all';
const sla = intakeSlaEnabled();
// Intentionally excluded from legacy "all"; activation uses independent principals.
const slaWorker = sla && role === 'sla-worker';
const slaPublisher = sla && role === 'sla-publisher';

@Module({
	imports: [config, CrmIntakePrismaModule],
	controllers: [
		CrmIntakeHealthController,
		...(api && sla ? [SlaController, SlaDeliveryController] : []),
		...(api
			? [
					IntakeController,
					InboxNotificationsController,
					LiveChangesController,
					IntakeExportController,
					IntakeIngestionController,
					AcceptanceController,
					IntakeCsvImportController
				]
			: [])
	],
	providers: [
		CrmIntakeHealthService,
		...(sla && (api || slaWorker || slaPublisher)
			? [SlaAuthorityClient, SlaRecipientsClient, SlaReadinessService]
			: []),
		...(sla && (api || slaPublisher) ? [SlaService] : []),
		...(sla && api ? [SlaDeliveryService, SlaDeliveryGuard] : []),
		...(slaWorker || slaPublisher ? [SlaRabbit] : []),
		...(slaWorker ? [SlaProcessor, SlaWorker] : []),
		...(slaPublisher ? [SlaPublisher] : []),
		...(api || worker
			? [IntakeAuthorizationClient]
			: []),
		...(api
			? [
					IntakeService,
					InboxNotificationsService,
					LiveChangesService,
					IntakeExportService,
					IntakeCsvImportService,
					IntakeIngestionService,
					IntakeIngestionRateLimiter,
					AcceptanceService
				]
			: []),
		...(worker || publisher ? [AcceptanceRabbit] : []),
		...(worker
			? [AcceptanceOperationsClient, AcceptanceProcessor, AcceptanceWorker]
			: []),
		...(publisher ? [AcceptancePublisher] : [])
	]
})
export class CrmIntakeModule {}
