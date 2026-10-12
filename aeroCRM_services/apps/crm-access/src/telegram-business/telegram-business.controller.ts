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
	Req
} from '@nestjs/common';
import type { Request } from 'express';
import {
	TelegramWorkspaceQueryDto,
	TelegramCreateConnectSessionDto,
	TelegramConnectSessionCommandDto,
	TelegramDisconnectChannelDto,
	TelegramReplyDto
} from './telegram-business.dto';
import { TelegramBusinessService } from './telegram-business.service';
import { TelegramBusinessWebhook } from './telegram-business.webhook';

const uuid = new ParseUUIDPipe({ version: '4' });
const checkKey = (key: string | undefined, id: string) => {
	if (key !== id) throw new BadRequestException('Idempotency-Key must match commandId');
};

@Controller('crm/access/telegram')
export class TelegramBusinessController {
	constructor(private readonly telegram: TelegramBusinessService) {}

	@Get('channels')
	@Header('Cache-Control', 'no-store')
	channels(@Headers('authorization') token: string | undefined, @Query() query: TelegramWorkspaceQueryDto) {
		return this.telegram.channels(token, query.workspaceId);
	}

	@Post('connect-sessions')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	createSession(@Headers('authorization') token: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() dto: TelegramCreateConnectSessionDto) {
		checkKey(key, dto.commandId);
		return this.telegram.createSession(token, dto);
	}

	@Get('connect-sessions/:id')
	@Header('Cache-Control', 'no-store')
	session(@Headers('authorization') token: string | undefined, @Param('id', uuid) id: string, @Query() query: TelegramWorkspaceQueryDto) {
		return this.telegram.session(token, id, query.workspaceId);
	}

	@Post('connect-sessions/:id/confirm')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	confirmSession(@Headers('authorization') token: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('id', uuid) id: string, @Body() dto: TelegramConnectSessionCommandDto) {
		checkKey(key, dto.commandId);
		return this.telegram.confirmSession(token, id, dto);
	}

	@Post('connect-sessions/:id/cancel')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	cancelSession(@Headers('authorization') token: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('id', uuid) id: string, @Body() dto: TelegramConnectSessionCommandDto) {
		checkKey(key, dto.commandId);
		return this.telegram.cancelSession(token, id, dto);
	}

	@Post('channels/:id/disconnect')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	disconnect(@Headers('authorization') token: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('id', uuid) id: string, @Body() dto: TelegramDisconnectChannelDto) {
		checkKey(key, dto.commandId);
		return this.telegram.disconnect(token, id, dto);
	}

	@Post('messages/:sourceMessageId/replies')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	reply(@Headers('authorization') token: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('sourceMessageId', uuid) sourceMessageId: string, @Body() dto: TelegramReplyDto) {
		checkKey(key, dto.commandId);
		return this.telegram.reply(token, sourceMessageId, dto);
	}

	@Get('commands/:commandId')
	@Header('Cache-Control', 'no-store')
	command(@Headers('authorization') token: string | undefined, @Param('commandId', uuid) commandId: string, @Query() query: TelegramWorkspaceQueryDto) {
		return this.telegram.commandStatus(token, query.workspaceId, commandId);
	}
}

@Controller('telegram-bot')
export class TelegramBusinessWebhookController {
	constructor(private readonly webhook: TelegramBusinessWebhook) {}

	@Post('business-webhook')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	accept(@Req() request: Request & { rawBody?: Buffer }, @Body() body: unknown) {
		return this.webhook.admit(request.rawBody, request.rawHeaders, body);
	}
}
