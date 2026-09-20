import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingAuthGuard } from './auth/billing-auth.guard';
import { BillingOperationsGuard } from './auth/billing-operations.guard';
import { BillingCampaignsGuard } from './auth/billing-campaigns.guard';
import { BillingIdentityGuard } from './auth/billing-identity.guard';
import { BillingCrmAccessGuard } from './auth/billing-crm-access.guard';
import { BillingCampaignAudienceService } from './domain/billing-campaign-audience.service';
import { BillingAdminAlertsService } from './domain/billing-admin-alerts.service';
import { InternalCommandsService } from './domain/internal-commands.service';
import { CrmEntitlementService } from './domain/crm-entitlement.service';
import { CrmCommercialPolicyService } from './domain/crm-commercial-policy.service';
import { CrmCommerceService } from './domain/crm-commerce.service';
import { BillingCrmCommerceController } from './http/billing-crm-commerce.controller';
import { BillingCrmWebhookController, BillingCrmProviderController } from './http/billing-crm-provider.controller';
import { CrmProviderRabbitMqService } from './provider/crm-provider-rabbitmq.service';
import { CrmProviderWorkerService } from './provider/crm-provider-worker.service';
import { CrmAccessAuthorizationClient } from './provider/crm-access-authorization.client';
import { CrmCommerceSchedulerService } from './scheduler/crm-commerce-scheduler.service';
import { BillingMessagingAdminService } from './domain/billing-messaging-admin.service';
import { BillingHealthController } from './health/billing-health.controller';
import { BillingHealthService } from './health/billing-health.service';
import { BillingCampaignAudienceController } from './http/billing-campaign-audience.controller';
import { BillingOperationsController } from './http/billing-operations.controller';
import { BillingIdentityController } from './http/billing-identity.controller';
import { BillingCrmAccessController } from './http/billing-crm-access.controller';
import { BillingSettingsController } from './http/billing-settings.controller';
import { CrmAdminSubscriptionController } from './http/crm-admin-subscription.controller';
import { CrmAdminSubscriptionService } from './domain/crm-admin-subscription.service';
import { IdentityInternalClient } from './internal/identity-internal.client';
import { BillingOutboxPublisherService } from './messaging/billing-outbox-publisher.service';
import { BillingRabbitMqService } from './messaging/billing-rabbitmq.service';
import { BillingWorkerService } from './messaging/billing-worker.service';
import { BillingPrismaModule } from './prisma/billing-prisma.module';
import { BillingPrismaService } from './prisma/billing-prisma.service';
import { BillingProjectionService } from './projections/billing-projection.service';
import { PaymentMethodCryptoService } from './provider/payment-method-crypto.service';
import { YooKassaService } from './provider/yookassa.service';
import { BillingRuntimeModule } from './runtime/billing-runtime.module';
import { parseBillingProcessRole } from './runtime/billing-runtime.service';

const BILLING_PROCESS_ROLE = parseBillingProcessRole(
	process.env.BILLING_PROCESS_ROLE
);

const API_CONTROLLERS =
	BILLING_PROCESS_ROLE === 'api'
		? [
				CrmAdminSubscriptionController,
				BillingCampaignAudienceController,
				BillingCrmAccessController,
				BillingCrmCommerceController,
				BillingCrmProviderController,
				BillingCrmWebhookController,
				BillingIdentityController,
				BillingSettingsController,
				BillingOperationsController
			]
		: [];

const API_PROVIDERS =
	BILLING_PROCESS_ROLE === 'api'
		? [
				BillingAuthGuard,
				BillingOperationsGuard,
				BillingCampaignsGuard,
				BillingCrmAccessGuard,
				BillingIdentityGuard
			]
		: [];

@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true }),
		BillingRuntimeModule,
		BillingPrismaModule
	],
	controllers: [BillingHealthController, ...API_CONTROLLERS],
	providers: [
		...API_PROVIDERS,
		IdentityInternalClient,
		CrmAdminSubscriptionService,
		InternalCommandsService,
		CrmEntitlementService,
		CrmCommercialPolicyService,
		CrmCommerceService,
		CrmAccessAuthorizationClient,
		CrmProviderRabbitMqService,
		CrmProviderWorkerService,
		CrmCommerceSchedulerService,
		BillingCampaignAudienceService,
		BillingAdminAlertsService,
		BillingMessagingAdminService,
		BillingProjectionService,
		PaymentMethodCryptoService,
		YooKassaService,
		BillingRabbitMqService,
		BillingWorkerService,
		BillingOutboxPublisherService,
		BillingHealthService
	]
})
export class BillingModule implements OnApplicationShutdown {
	constructor(private readonly prisma: BillingPrismaService) {}

	async onApplicationShutdown(): Promise<void> {
		await this.prisma.disconnect();
	}
}
