import { Controller, Get, Headers, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/identity-client';
import type { Response } from 'express';
import { AccessJwtService } from './access-jwt.service';
import {
	Auth,
	CurrentUser,
	IdentityAuthGuard,
	type IdentityActor
} from './auth.guard';
import { SessionEventsService } from './session-events.service';

@Controller()
export class SessionEventsController {
	constructor(
		private readonly events: SessionEventsService,
		private readonly jwt: AccessJwtService
	) {}
	@Get('auth/session/events')
	@Auth(Role.USER, Role.ADMIN, Role.DEV)
	@UseGuards(IdentityAuthGuard)
	async open(
		@CurrentUser() actor: IdentityActor,
		@Headers('authorization') authorization: string,
		@Res() response: Response
	) {
		const payload = this.jwt.verify(authorization.slice(7));
		await this.events.open(
			actor.sessionId,
			actor.id,
			payload.exp * 1000,
			response
		);
	}
}
