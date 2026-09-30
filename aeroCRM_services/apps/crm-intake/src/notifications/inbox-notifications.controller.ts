import {
	Body,
	Controller,
	Get,
	Headers,
	Param,
	ParseUUIDPipe,
	Put,
	Query,
	ForbiddenException,
	Header
} from '@nestjs/common';
import { IntakeAuthorizationClient } from '../access/intake-authorization.client';
import { InboxNotificationsService } from './inbox-notifications.service';
import {
	InboxNotificationsQuery,
	InboxNotificationReadDto,
	InboxNotificationEntryReadDto
} from './inbox-notifications.dto';

@Controller('crm/intake/notifications')
export class InboxNotificationsController {
	constructor(
		private readonly authorization: IntakeAuthorizationClient,
		private readonly notifications: InboxNotificationsService
	) {}
	@Get()
	@Header('Cache-Control', 'no-store')
	async list(
		@Headers('authorization') bearer: string | undefined,
		@Query() query: InboxNotificationsQuery
	) {
		const access = await this.authorization.authorize(
			bearer,
			query.workspaceId
		);
		const result = await this.notifications.list(access, query);
		if (
			JSON.stringify(
				await this.authorization.authorize(bearer, query.workspaceId)
			) !== JSON.stringify(access)
		)
			throw new ForbiddenException();
		return result;
	}
	@Put(':id/read')
	@Header('Cache-Control', 'no-store')
	async read(
		@Headers('authorization') bearer: string | undefined,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() dto: InboxNotificationReadDto
	) {
		const access = await this.authorization.authorize(
			bearer,
			dto.workspaceId
		);
		return this.notifications.setRead(access, id, dto);
	}
	@Put('entries/:entryId/read')
	@Header('Cache-Control', 'no-store')
	async readEntry(
		@Headers('authorization') bearer: string | undefined,
		@Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
		@Body() dto: InboxNotificationEntryReadDto
	) {
		const access = await this.authorization.authorize(bearer, dto.workspaceId);
		return this.notifications.setEntryRead(access, entryId, dto);
	}
}
