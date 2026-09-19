import {
	Body,
	Controller,
	Get,
	Headers,
	HttpCode,
	Post,
	Req,
	UseGuards,
	UsePipes,
	ValidationPipe
} from '@nestjs/common';
import { Role } from '@prisma/identity-client';
import type { Request } from 'express';
import { Auth, CurrentUser, IdentityAuthGuard } from '../auth/auth.guard';
import {
	TelegramService,
	type TelegramWebhookUpdate
} from './telegram.service';

@Controller()
@UsePipes(
	new ValidationPipe({
		whitelist: true,
		forbidNonWhitelisted: true,
		transform: true
	})
)
export class TelegramController {
	constructor(private readonly telegram: TelegramService) {}

	@Post('telegram-bot/webhook')
	@HttpCode(200)
	infoWebhook(
		@Body() update: TelegramWebhookUpdate,
		@Headers('x-telegram-bot-api-secret-token') secret?: string
	) {
		return this.telegram.handleInfoWebhook(update, secret);
	}
}

@Controller('telegram-info/admin')
@UseGuards(IdentityAuthGuard)
export class TelegramAdminController {
	constructor(private readonly telegram: TelegramService) {}

	@Get('settings')
	@Auth(Role.ADMIN)
	settings() {
		return this.telegram.adminSettings();
	}

	@Get('info-webhook/status')
	@Auth(Role.ADMIN)
	infoStatus() {
		return this.telegram.infoWebhookStatus();
	}

	@Post('info-webhook/reinstall')
	@HttpCode(200)
	@Auth(Role.ADMIN)
	reinstallInfo(
		@CurrentUser('id') actorId: string,
		@Req() request: Request
	) {
		return this.telegram.reinstallInfoWebhook(actorId, request);
	}
}
