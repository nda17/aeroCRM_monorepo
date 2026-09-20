import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Header,
	Headers,
	HttpCode,
	Param,
	Post,
	Query,
	Req,
	UseGuards,
	UsePipes,
	ValidationPipe
} from '@nestjs/common';
import { Equals, IsInt, IsUUID, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { BillingAuth, BillingAuthGuard } from '../auth/billing-auth.guard';
import { CurrentBillingActor } from '../auth/current-billing-actor.decorator';
import type { BillingActor } from '../auth/billing-request';
import { getBillingClientContext } from '../common/billing-request-context';
import { CrmCommerceService } from '../domain/crm-commerce.service';

export class RetryCrmProviderDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') commandId!: string;
	@IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}

@Controller('payments/admin/crm-provider-operations')
export class BillingCrmProviderController {
	constructor(private readonly commerce: CrmCommerceService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@BillingAuth(['ADMIN', 'DEV'])
	@UseGuards(BillingAuthGuard)
	list(
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Query('status') status?: string
	) {
		const parsedPage = Number(page ?? '1');
		const parsedLimit = Number(limit ?? '20');
		if (
			!Number.isSafeInteger(parsedPage) ||
			parsedPage < 1 ||
			!Number.isSafeInteger(parsedLimit) ||
			parsedLimit < 1 ||
			parsedLimit > 100 ||
			(status && !['PENDING', 'PROCESSING', 'UNKNOWN', 'FAILED', 'DELIVERED'].includes(status))
		) {
			throw new BadRequestException('Invalid provider operation filter');
		}
		return this.commerce.listProviderOperations({
			page: parsedPage,
			limit: parsedLimit,
			status
		});
	}

	@Post(':operationId/retry')
	@HttpCode(202)
	@Header('Cache-Control', 'no-store')
	@BillingAuth(['DEV'])
	@UseGuards(BillingAuthGuard)
	@UsePipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true
		})
	)
	retry(
		@Param('operationId') operationId: string,
		@Body() dto: RetryCrmProviderDto,
		@CurrentBillingActor() actor: BillingActor,
		@Req() request: Request,
		@Headers('idempotency-key') key?: string
	) {
		if (key !== dto.commandId)
			throw new BadRequestException(
				'Idempotency-Key must match commandId'
			);
		return this.commerce.retryProviderOperation(operationId, dto, {
			id: actor.subject,
			role: actor.roles.includes('DEV') ? 'DEV' : 'ADMIN',
			...getBillingClientContext(request)
		});
	}
}

@Controller('payments')
export class BillingCrmWebhookController {
	constructor(private readonly commerce: CrmCommerceService) {}

	@Post('webhook')
	@HttpCode(200)
	async webhook(@Body() body: unknown) {
		// The queued worker verifies the payment with YooKassa before changing state.
		// Unknown provider IDs cannot mutate a CRM order.
		await this.commerce.enqueueProviderVerification(body);
		return { ok: true };
	}
}
