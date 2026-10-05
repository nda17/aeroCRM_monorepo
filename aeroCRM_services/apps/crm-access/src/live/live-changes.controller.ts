import {
	Controller,
	Get,
	Headers,
	Query,
	Res,
	ParseUUIDPipe,
	ForbiddenException
} from '@nestjs/common';
import type { Response } from 'express';
import { CrmAuthorizationService } from '../authorization/crm-authorization.service';
import { AccessLiveChangesService } from './live-changes.service';
@Controller('crm/access')
export class AccessLiveChangesController {
	constructor(
		private readonly auth: CrmAuthorizationService,
		private readonly live: AccessLiveChangesService
	) {}
	@Get('events')
	async events(
		@Headers('authorization') token: string | undefined,
		@Query('workspaceId', new ParseUUIDPipe({ version: '4' }))
		workspaceId: string,
		@Res() response: Response
	) {
		const initial = await this.auth.authorize(token, workspaceId);
		const binding = await this.auth.assignmentSubject(
			workspaceId,
			initial.subject
		);
		return this.live.open(
			workspaceId,
			initial.subject,
			response,
			async () => {
				const current = await this.auth.authorize(token, workspaceId);
				const member = await this.auth.assignmentSubject(
					workspaceId,
					current.subject
				);
				if (
					JSON.stringify(initial) !== JSON.stringify(current) ||
					member.membershipId !== binding.membershipId
				)
					throw new ForbiddenException();
			}
		);
	}
}
