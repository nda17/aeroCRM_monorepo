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
	Put,
	Query
} from '@nestjs/common';
import { ChatQueryDto } from './workspace-chat.dto';
import { MessengerMessagesV3QueryDto, MessengerReadV3Dto } from './workspace-messenger.dto';
import { WorkspaceMessengerService } from './workspace-messenger.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('crm/access/chat')
export class WorkspaceMessengerController {
	constructor(private readonly messenger: WorkspaceMessengerService) {}

	@Get('conversations-v3')
	@Header('Cache-Control', 'no-store')
	conversations(
		@Headers('authorization') token: string | undefined,
		@Query() query: ChatQueryDto
	) {
		return this.messenger.conversations(token, query);
	}

	@Get('conversations/:id/messages-v3')
	@Header('Cache-Control', 'no-store')
	messages(
		@Headers('authorization') token: string | undefined,
		@Param('id', uuid) id: string,
		@Query() query: MessengerMessagesV3QueryDto
	) {
		return this.messenger.messages(token, id, query);
	}

	@Put('conversations/:id/read-v3')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	read(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: MessengerReadV3Dto
	) {
		if (key !== dto.commandId)
			throw new BadRequestException('Idempotency-Key must match commandId');
		return this.messenger.read(token, id, dto);
	}
}
