import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Headers,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Req,
	UseGuards
} from '@nestjs/common';
import { BulkAssignmentService } from '../bulk-assignment/bulk-assignment.service';
import { LossReasonsService } from '../loss-reasons/loss-reasons.service';
import {
	SalesAccessGuard,
	SalesPermission,
	type SalesRequest
} from './sales-access';
import { SalesListQuery, WorkspaceQuery } from './sales.dto';
import {
	BulkAssignmentApplyDto,
	BulkAssignmentPreviewDto,
	LossReportQuery,
	SaveLossReasonsDto,
	TransitionDealV2Dto
} from './sales-productivity.dto';
import { SalesService } from './sales.service';

@Controller('crm/sales')
@UseGuards(SalesAccessGuard)
export class SalesProductivityController {
	constructor(
		private readonly sales: SalesService,
		private readonly reasons: LossReasonsService,
		private readonly bulk: BulkAssignmentService
	) {}

	@Get('loss-reasons')
	@SalesPermission('sales:read')
	lossReasons(@Query() query: WorkspaceQuery, @Req() request: SalesRequest) {
		return this.reasons.settings(request.salesAccess, query.workspaceId);
	}

	@Post('loss-reasons')
	@HttpCode(200)
	@SalesPermission('sales:write')
	saveLossReasons(
		@Body() dto: SaveLossReasonsDto,
		@Req() request: SalesRequest,
		@Headers('idempotency-key') key?: string
	) {
		this.commandKey(dto.commandId, key);
		return this.reasons.save(request.salesAccess, dto, request.headers.authorization!);
	}

	@Get('loss-report')
	@SalesPermission('sales:analytics')
	lossReport(@Query() query: LossReportQuery, @Req() request: SalesRequest) {
		return this.sales.lossReport(request.salesAccess, query);
	}

	@Get('deals/:id/loss')
	@SalesPermission('sales:read')
	loss(
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Query() query: WorkspaceQuery,
		@Req() request: SalesRequest
	) {
		return this.sales.loss(request.salesAccess, id, query.archive);
	}

	@Get('deals/:id/timeline-v4')
	@SalesPermission('sales:read')
	timelineV4(
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Query() query: SalesListQuery,
		@Req() request: SalesRequest
	) {
		return this.sales.timelineV4(request.salesAccess, id, query);
	}

	@Post('deals/:id/transition-v2')
	@HttpCode(200)
	@SalesPermission('sales:write')
	transitionV2(
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() dto: TransitionDealV2Dto,
		@Req() request: SalesRequest,
		@Headers('idempotency-key') key?: string
	) {
		this.commandKey(dto.commandId, key);
		return this.sales.transitionV2(
			request.salesAccess, id, dto, request.headers.authorization!
		);
	}

	@Post('bulk-assignment/preview')
	@HttpCode(200)
	@SalesPermission('sales:write')
	bulkPreview(@Body() dto: BulkAssignmentPreviewDto, @Req() request: SalesRequest) {
		return this.bulk.preview(request.salesAccess, dto, request.headers.authorization!);
	}

	@Post('bulk-assignment/apply')
	@HttpCode(200)
	@SalesPermission('sales:write')
	bulkApply(
		@Body() dto: BulkAssignmentApplyDto,
		@Req() request: SalesRequest,
		@Headers('idempotency-key') key?: string
	) {
		this.commandKey(dto.commandId, key);
		return this.bulk.apply(request.salesAccess, dto, request.headers.authorization!);
	}

	private commandKey(commandId: string, key: string | undefined) {
		if (key !== commandId)
			throw new BadRequestException('Idempotency-Key must match commandId');
	}
}
