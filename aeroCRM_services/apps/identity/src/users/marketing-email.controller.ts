import {
	BadRequestException, Body, Controller, Get, Header, HttpCode, Post, Req,
	UseGuards
} from '@nestjs/common';
import type { Request } from 'express';
import { IdentityInternalGuard, InternalServices } from '../internal/internal.guard';
import { MarketingEmailService } from './marketing-email.service';

@Controller('marketing/email')
export class MarketingEmailUnsubscribeController {
	constructor(private readonly marketing: MarketingEmailService) {}

	@Get('unsubscribe')
	@Header('Cache-Control', 'no-store')
	@Header('Referrer-Policy', 'no-referrer')
	@Header('X-Robots-Tag', 'noindex, nofollow')
	confirmation() {
		return { message: 'Откройте ссылку отписки из письма и подтвердите действие.' };
	}

	@Post('unsubscribe')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@Header('Referrer-Policy', 'no-referrer')
	unsubscribe(@Body() body: unknown, @Req() request: Request) {
		const row = body && typeof body === 'object' && !Array.isArray(body)
			? body as Record<string, unknown> : null;
		if (!request.is('application/json') || Object.keys(request.query).length !== 0 ||
			!row || Object.keys(row).join(',') !== 'token')
			throw new BadRequestException('Invalid unsubscribe request');
		return this.marketing.unsubscribe(row.token);
	}

}

@Controller('internal/v1/notification-delivery/marketing-email')
@UseGuards(IdentityInternalGuard)
export class MarketingEmailAuthorizationController {
	constructor(private readonly marketing: MarketingEmailService) {}

	@Post('authorize')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@InternalServices('notification-delivery')
	authorize(@Body() body: unknown) {
		return this.marketing.authorize(body);
	}
}
