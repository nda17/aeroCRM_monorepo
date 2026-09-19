import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Header,
	Headers,
	HttpCode,
	Put,
	Req,
	UseGuards,
	UsePipes,
	ValidationPipe
} from '@nestjs/common';
import type { Request } from 'express';
import { BillingAuth, BillingAuthGuard } from '../auth/billing-auth.guard';
import { CurrentBillingActor } from '../auth/current-billing-actor.decorator';
import type { BillingActor } from '../auth/billing-request';
import { getBillingClientContext } from '../common/billing-request-context';
import { CrmCommercialPolicyService } from '../domain/crm-commercial-policy.service';
import {
	UpdateCrmCommercialPolicyDto
} from './billing.dto';

@Controller('billing-settings')
export class BillingSettingsController {
	constructor(private readonly crmPolicy: CrmCommercialPolicyService) {}

	@Get('crm')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@BillingAuth()
	@UseGuards(BillingAuthGuard)
	crmPricing() {
		// Product prices are shared, not a workspace entitlement or payment quote.
		// Use the same immutable policy as administration, without granting writes.
		return this.crmPolicy.get();
	}

	@Get('crm/public')
	@HttpCode(200)
	@Header('Cache-Control', 'public, max-age=60')
	publicCrmPricing() {
		return this.crmPolicy.get();
	}

	@Get('admin/crm')
	@HttpCode(200)
	@BillingAuth(['ADMIN', 'DEV'])
	@UseGuards(BillingAuthGuard)
	crmSettings() {
		return this.crmPolicy.get();
	}

	@Put('admin/crm')
	@HttpCode(200)
	@BillingAuth(['ADMIN', 'DEV'])
	@UseGuards(BillingAuthGuard)
	@UsePipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true
		})
	)
	updateCrmSettings(
		@Body() dto: UpdateCrmCommercialPolicyDto,
		@CurrentBillingActor() actor: BillingActor,
		@Req() request: Request,
		@Headers('idempotency-key') idempotencyKey?: string
	) {
		if (idempotencyKey !== dto.commandId) {
			throw new BadRequestException({
				code: 'crm_commercial_policy_idempotency_key_mismatch',
				message: 'idempotency-key must match commandId'
			});
		}
		return this.crmPolicy.update(dto, {
			actor,
			...getBillingClientContext(request)
		});
	}

}
