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
	CreateSavedViewDto,
	DeleteSavedViewDto,
	ImportSavedViewsDto,
	RenameSavedViewDto,
	SavedViewsQueryDto
} from './saved-views.dto';
import { SavedViewsService } from './saved-views.service';

@Controller('crm/access/saved-views')
export class SavedViewsController {
	constructor(private readonly service: SavedViewsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	list(
		@Headers('authorization') token: string | undefined,
		@Query() query: SavedViewsQueryDto
	) {
		return this.service.list(token, query);
	}

	@Post()
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	create(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: CreateSavedViewDto
	) {
		this.commandKey(key, dto.commandId);
		return this.service.create(token, dto);
	}

	@Post('import')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	import(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: ImportSavedViewsDto
	) {
		this.commandKey(key, dto.commandId);
		return this.service.import(token, dto);
	}

	@Post(':id/rename')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	rename(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() dto: RenameSavedViewDto
	) {
		this.commandKey(key, dto.commandId);
		return this.service.rename(token, id, dto);
	}

	@Post(':id/delete')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	delete(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() dto: DeleteSavedViewDto
	) {
		this.commandKey(key, dto.commandId);
		return this.service.delete(token, id, dto);
	}

	private commandKey(key: string | undefined, commandId: string) {
		if (key !== commandId)
			throw new BadRequestException('Idempotency-Key must match commandId');
	}
}
