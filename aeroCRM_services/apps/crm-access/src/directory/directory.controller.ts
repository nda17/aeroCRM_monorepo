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
	DirectoryQueryDto,
	UpdateDirectoryDto,
	DirectoryCommandDto
} from './directory.dto';
import { DirectoryService } from './directory.service';
const uuid = new ParseUUIDPipe({ version: '4' });
const key = (header: string | undefined, id: string) => {
	if (header !== id)
		throw new BadRequestException('Idempotency-Key must match commandId');
};
@Controller('crm/access/directory')
export class DirectoryController {
	constructor(private readonly directory: DirectoryService) {}
	@Get()
	@Header('Cache-Control', 'no-store')
	list(
		@Headers('authorization') token: string | undefined,
		@Query() query: DirectoryQueryDto
	) {
		return this.directory.list(token, query);
	}
	@Post(':id/update')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	update(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: UpdateDirectoryDto
	) {
		key(commandKey, dto.commandId);
		return this.directory.update(token, id, dto);
	}
	@Post(':id/archive')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	archive(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: DirectoryCommandDto
	) {
		key(commandKey, dto.commandId);
		return this.directory.archive(token, id, dto, true);
	}
	@Post(':id/restore')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	restore(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: DirectoryCommandDto
	) {
		key(commandKey, dto.commandId);
		return this.directory.archive(token, id, dto, false);
	}
}
