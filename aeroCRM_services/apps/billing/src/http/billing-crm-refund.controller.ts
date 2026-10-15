import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Header,
	Headers,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Req,
	UseGuards,
	UsePipes,
	ValidationPipe
} from '@nestjs/common';
import type { Request } from 'express';
import { BillingAuth, BillingAuthGuard } from '../auth/billing-auth.guard';
import type { BillingActor } from '../auth/billing-request';
import { CurrentBillingActor } from '../auth/current-billing-actor.decorator';
import { getBillingClientContext } from '../common/billing-request-context';
import { CrmRefundService } from '../domain/crm-refund.service';
import {
	CrmRefundListQueryDto,
	ReviewCrmRefundDto,
	RetryCrmRefundDto
} from './crm-refund.dto';

@Controller('payments/admin/crm-refunds')
@BillingAuth(['ADMIN', 'DEV'])
@UseGuards(BillingAuthGuard)
@UsePipes(
	new ValidationPipe({
		whitelist: true,
		forbidNonWhitelisted: true,
		transform: true
	})
)
export class BillingCrmRefundController {
	constructor(private readonly refunds: CrmRefundService) {}
	@Get()
	@Header('Cache-Control', 'no-store')
	list(
		@Query() query: CrmRefundListQueryDto,
		@CurrentBillingActor() actor: BillingActor
	) {
		return this.refunds.list(query, actor);
	}
	@Get(':id')
	@Header('Cache-Control', 'no-store')
	detail(
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@CurrentBillingActor() actor: BillingActor
	) {
		return this.refunds.detail(id, actor);
	}
	@Post(':id/review')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	review(
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() dto: ReviewCrmRefundDto,
		@CurrentBillingActor() actor: BillingActor,
		@Req() request: Request,
		@Headers('idempotency-key') key?: string,
		@Headers('authorization') authorization?: string
	) {
		this.key(key, dto.commandId);
		return this.refunds.command(id, 'REVIEW', dto, {
			actor,
			authorization,
			...getBillingClientContext(request)
		});
	}
	@Post(':id/retry')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	retry(
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() dto: RetryCrmRefundDto,
		@CurrentBillingActor() actor: BillingActor,
		@Req() request: Request,
		@Headers('idempotency-key') key?: string,
		@Headers('authorization') authorization?: string
	) {
		this.key(key, dto.commandId);
		return this.refunds.command(id, 'RETRY', dto, {
			actor,
			authorization,
			...getBillingClientContext(request)
		});
	}
	private key(key: string | undefined, commandId: string) {
		if (key !== commandId)
			throw new BadRequestException(
				'Idempotency-Key must match commandId'
			);
	}
}
