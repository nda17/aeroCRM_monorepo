import {
	Body,
	Controller,
	ForbiddenException,
	Get,
	Header,
	Headers,
	HttpCode,
	Post,
	Query,
	UseGuards
} from '@nestjs/common';
import { ResolveSalesAssigneeDto } from './sales-assignee-binding.dto';
import { CrmAuthorizeWorkflowDto } from '../authorization/crm-authorization.controller';
import { CrmInternalGuard } from '../authorization/crm-internal.guard';
import {
	AssigneeLabelsDto,
	AssigneeQueryDto,
	AuthorizeAssigneeDto
} from './team-assignee.dto';
import { CrmAssigneeService } from './team-assignee.service';

@Controller('crm/access/team')
export class CrmAssigneeController {
	constructor(private readonly assignees: CrmAssigneeService) {}
	@Get('assignees')
	@Header('Cache-Control', 'no-store')
	options(
		@Headers('authorization') token: string | undefined,
		@Query() query: AssigneeQueryDto
	) {
		return this.assignees.options(token, query);
	}
	@Post('assignee-labels')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	labels(
		@Headers('authorization') token: string | undefined,
		@Body() dto: AssigneeLabelsDto
	) {
		return this.assignees.labels(token, dto);
	}
}

@Controller('internal/v1/crm-access')
@UseGuards(CrmInternalGuard)
export class CrmAssigneeAuthorizationController {
	constructor(private readonly assignees: CrmAssigneeService) {}
	@Post('resolve-sales-task-readers')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	readers(
		@Headers('x-aerocrm-service') caller: string,
		@Headers('authorization') token: string | undefined,
		@Body() dto: AssigneeLabelsDto
	) {
		if (caller !== 'crm-sales') throw new ForbiddenException();
		return this.assignees.taskReaders(token, dto);
	}
	@Post('resolve-sales-assignee')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	resolve(
		@Headers('x-aerocrm-service') caller: string,
		@Headers('authorization') token: string | undefined,
		@Body() dto: ResolveSalesAssigneeDto
	) {
		if (caller !== 'crm-sales') throw new ForbiddenException();
		return this.assignees.resolve(token, dto);
	}
	@Post('authorize-sales-intake')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	authorizeIntake(
		@Headers('x-aerocrm-service') caller: string,
		@Body() dto: CrmAuthorizeWorkflowDto
	) {
		if (caller !== 'crm-sales') throw new ForbiddenException();
		return this.assignees.authorizeIntake(dto);
	}
	@Post('authorize-assignee')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	authorize(
		@Headers('x-aerocrm-service') caller: string,
		@Headers('authorization') token: string | undefined,
		@Body() dto: AuthorizeAssigneeDto
	) {
		if (caller !== 'crm-sales')
			throw new ForbiddenException('Only Sales can authorize assignment');
		return this.assignees.authorize(token, dto);
	}
}
