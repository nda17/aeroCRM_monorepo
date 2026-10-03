import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Header,
	Headers,
	HttpCode,
	Post,
	Query,
	Req,
	UseGuards
} from '@nestjs/common';
import {
	SalesAccessGuard,
	SalesPermission,
	type SalesRequest
} from '../sales/sales-access';
import { WorkspaceQuery } from '../sales/sales.dto';
import { SavePlannerSettingsDto } from './planner.dto';
import { PlannerService } from './planner.service';

@Controller('crm/sales/planner/settings')
@UseGuards(SalesAccessGuard)
export class PlannerController {
	constructor(private readonly service: PlannerService) {}
	@Get()
	@SalesPermission('sales:read')
	@Header('Cache-Control', 'no-store')
	settings(@Query() query: WorkspaceQuery, @Req() request: SalesRequest) {
		return this.service.settings(request.salesAccess, query.workspaceId);
	}
	@Post()
	@HttpCode(200)
	@SalesPermission('sales:write')
	@Header('Cache-Control', 'no-store')
	save(
		@Body() dto: SavePlannerSettingsDto,
		@Req() request: SalesRequest,
		@Headers('idempotency-key') key?: string
	) {
		if (key !== dto.commandId)
			throw new BadRequestException(
				'Idempotency-Key must match commandId'
			);
		return this.service.save(
			request.salesAccess,
			dto,
			request.headers.authorization!
		);
	}
}
