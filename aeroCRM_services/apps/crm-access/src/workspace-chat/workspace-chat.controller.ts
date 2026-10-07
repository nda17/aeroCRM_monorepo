import {
	ChatMessagesV2QueryDto,
	SendMessageV2Dto
} from './chat-messages-v2.dto';
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
	Put,
	Query
} from '@nestjs/common';
import {
	ChatQueryDto,
	MessageQueryDto,
	DirectChatDto,
	SendMessageDto,
	ReadChatDto,
	NotificationQueryDto
} from './workspace-chat.dto';
import { WorkspaceChatService } from './workspace-chat.service';
const uuid = new ParseUUIDPipe({ version: '4' });
const key = (header: string | undefined, id: string) => {
	if (header !== id)
		throw new BadRequestException('Idempotency-Key must match commandId');
};
@Controller('crm/access/chat')
export class WorkspaceChatController {
	constructor(private readonly chat: WorkspaceChatService) {}
	@Get('conversations')
	@Header('Cache-Control', 'no-store')
	list(
		@Headers('authorization') token: string | undefined,
		@Query() query: ChatQueryDto
	) {
		return this.chat.list(token, query);
	}
	@Post('conversations/direct')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	direct(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Body() dto: DirectChatDto
	) {
		key(commandKey, dto.commandId);
		return this.chat.direct(token, dto);
	}
	@Get('conversations/:id/messages')
	@Header('Cache-Control', 'no-store')
	messages(
		@Headers('authorization') token: string | undefined,
		@Param('id', uuid) id: string,
		@Query() query: MessageQueryDto
	) {
		return this.chat.messages(token, id, query);
	}
	@Post('conversations/:id/messages')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	send(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: SendMessageDto
	) {
		key(commandKey, dto.commandId);
		return this.chat.send(token, id, dto);
	}
	@Get('conversations/:id/messages-v2/commands/:commandId')
	@Header('Cache-Control', 'no-store')
	sendLookup(
		@Headers('authorization') token: string | undefined,
		@Param('id', uuid) id: string,
		@Param('commandId', uuid) commandId: string,
		@Query() dto: ChatMessagesV2QueryDto
	) {
		return this.chat.sendLookup(token, id, dto.workspaceId, commandId);
	}
	@Get('conversations/:id/messages-v2')
	@Header('Cache-Control', 'no-store')
	messagesV2(
		@Headers('authorization') token: string | undefined,
		@Param('id', uuid) id: string,
		@Query() dto: ChatMessagesV2QueryDto
	) {
		return this.chat.messagesV2(token, id, dto);
	}
	@Post('conversations/:id/messages-v2')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	sendV2(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: SendMessageV2Dto
	) {
		key(commandKey, dto.commandId);
		return this.chat.send(token, id, dto);
	}

	@Put('conversations/:id/read')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	read(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') commandKey: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: ReadChatDto
	) {
		key(commandKey, dto.commandId);
		return this.chat.read(token, id, dto);
	}
	@Get('notifications')
	@Header('Cache-Control', 'no-store')
	notifications(
		@Headers('authorization') token: string | undefined,
		@Query() query: NotificationQueryDto
	) {
		return this.chat.notifications(token, query);
	}
}
