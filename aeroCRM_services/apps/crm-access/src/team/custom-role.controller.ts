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
	Query
} from '@nestjs/common';
import {
	CreateCustomRoleDto,
	UpdateCustomRoleDto
} from './custom-role.dto';
import { CrmCustomRoleService } from './custom-role.service';
import { TeamQueryDto, VersionedTeamCommandDto } from './team.dto';

const uuid = new ParseUUIDPipe({ version: '4' });
const key = (header: string | undefined, commandId: string) => {
	if (header !== commandId)
		throw new BadRequestException('Idempotency-Key must match commandId');
};

@Controller('crm/access/team/roles')
export class CrmCustomRoleController {
	constructor(private readonly roles: CrmCustomRoleService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	list(
		@Headers('authorization') token: string | undefined,
		@Query() query: TeamQueryDto
	) {
		return this.roles.list(token, query);
	}

	@Post()
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	create(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Body() dto: CreateCustomRoleDto
	) {
		key(commandKey, dto.commandId);
		return this.roles.create(token, dto);
	}

	@Post(':id/update')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	update(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: UpdateCustomRoleDto
	) {
		key(commandKey, dto.commandId);
		return this.roles.update(token, id, dto);
	}

	@Post(':id/archive')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	archive(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: VersionedTeamCommandDto
	) {
		key(commandKey, dto.commandId);
		return this.roles.archive(token, id, dto);
	}
}
