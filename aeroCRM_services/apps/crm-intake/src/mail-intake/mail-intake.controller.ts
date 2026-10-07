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
	Query
} from '@nestjs/common';
import {
	MailIntakeCommandsQueryDto,
	MailIntakeCreateDto,
	MailIntakePreviewQueryDto,
	MailIntakeSourceQueryDto
} from './mail-intake.dto';
import { MailIntakeService } from './mail-intake.service';

@Controller('crm/intake/mail')
export class MailIntakeController {
	constructor(private readonly mail: MailIntakeService) {}
	@Get('preview') preview(
		@Headers('authorization') bearer: string | undefined,
		@Query() query: MailIntakePreviewQueryDto
	) {
		return this.mail.preview(bearer, query.workspaceId, query.messageId);
	}
	@Post('entries')
	@HttpCode(200)
	create(
		@Headers('authorization') bearer: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailIntakeCreateDto
	) {
		if (key !== dto.commandId)
			throw new BadRequestException('Idempotency-Key must match commandId');
		return this.mail.create(bearer, dto);
	}
	@Get('commands/:commandId') command(
		@Headers('authorization') bearer: string | undefined,
		@Param('commandId', new ParseUUIDPipe({ version: '4' })) id: string,
		@Query() query: MailIntakeCommandsQueryDto
	) {
		return this.mail.command(bearer, query.workspaceId, id);
	}
	@Get('entries/:entryId/source') source(
		@Headers('authorization') bearer: string | undefined,
		@Param('entryId', new ParseUUIDPipe({ version: '4' })) id: string,
		@Query() query: MailIntakeSourceQueryDto
	) {
		return this.mail.source(bearer, query.workspaceId, id);
	}
}
