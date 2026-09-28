import {
	BadRequestException,
	Body,
	CanActivate,
	Controller,
	ExecutionContext,
	Get,
	Header,
	ForbiddenException,
	Headers,
	HttpCode,
	Injectable,
	Param,
	ParseUUIDPipe,
	Post,
	Put,
	Query,
	Res,
	UploadedFile,
	UseGuards,
	UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { MailService } from './mail.service';
import {
	MailConnectDto,
	MailReconnectDto,
	MailDisconnectDto,
	MailFoldersDto,
	MailGrantsDto,
	MailLinkDto,
	MailPrepareAttachmentDto,
	MailQueryDto,
	MailMessagesQuery,
	MailMessageQuery,
	MailSendDto,
	MailUploadDto,
	MailNotificationsQuery,
	MailNotificationReadDto
} from './mail.dto';
import { MAIL_LIMITS } from './mail.config';
@Injectable()
export class MailUploadScopeGuard implements CanActivate {
	constructor(private readonly mail: MailService) {}
	async canActivate(context: ExecutionContext) {
		const request = context.switchToHttp().getRequest<Request>();
		const workspace = request.header('x-mail-workspace-id'),
			mailbox = request.header('x-mail-mailbox-id'),
			contact = request.header('x-mail-contact-id');
		if (!workspace || !mailbox)
			throw new BadRequestException({ code: 'crm_mail_upload_scope_required' });
		const a = await this.mail.authority(
			request.header('authorization'),
			workspace
		);
		await this.mail.mailbox(a, mailbox, 'send');
		if (contact !== undefined) await this.mail.contact(a, contact);
		return true;
	}
}
@Controller('crm/customers/mail')
export class MailController {
	constructor(private readonly mail: MailService) {}
	private async command(
		token: string | undefined,
		key: string | undefined,
		dto: { workspaceId: string; commandId: string }
	) {
		if (key !== dto.commandId)
			throw new BadRequestException({
				code: 'crm_mail_idempotency_key_required'
			});
		return this.mail.authority(token, dto.workspaceId);
	}
	@Get('capabilities') async capabilities(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto
	) {
		return this.mail.capabilities(
			await this.mail.authority(token, query.workspaceId)
		);
	}
	@Get('notifications')
	@Header('Cache-Control', 'no-store')
	async notifications(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailNotificationsQuery
	) {
		const a = await this.mail.authority(token, query.workspaceId);
		const result = await this.mail.notifications(a, query);
		if (
			JSON.stringify(await this.mail.authority(token, query.workspaceId)) !==
			JSON.stringify(a)
		)
			throw new ForbiddenException();
		return result;
	}
	@Put('notifications/:id/read')
	@Header('Cache-Control', 'no-store')
	async readNotification(
		@Headers('authorization') token: string | undefined,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() dto: MailNotificationReadDto
	) {
		const a = await this.mail.authority(token, dto.workspaceId);
		const result = await this.mail.readNotification(a, id, dto);
		if (
			JSON.stringify(await this.mail.authority(token, dto.workspaceId)) !==
			JSON.stringify(a)
		)
			throw new ForbiddenException();
		return result;
	}

	@Get('mailboxes') async mailboxes(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto
	) {
		return this.mail.mailboxes(
			await this.mail.authority(token, query.workspaceId),
			query
		);
	}
	@Post('connections') @HttpCode(200) async connect(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailConnectDto
	) {
		return this.mail.connect(await this.command(token, key, dto), dto);
	}

	@Get('mailboxes/:id/connection') async readConnection(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.readConnection(
			await this.mail.authority(token, query.workspaceId),
			id
		);
	}
	@Put('mailboxes/:id/connection') async reconnect(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailReconnectDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.reconnect(await this.command(token, key, dto), id, dto);
	}
	@Get('mailboxes/:id/folders') async folders(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.folders(
			await this.mail.authority(token, query.workspaceId),
			id
		);
	}
	@Put('mailboxes/:id/folders') async setFolders(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailFoldersDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.setFolders(await this.command(token, key, dto), id, dto);
	}
	@Get('mailboxes/:id/grants') async grantsList(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.readGrants(
			await this.mail.authority(token, query.workspaceId),
			id
		);
	}
	@Put('mailboxes/:id/grants') async grants(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailGrantsDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.grants(await this.command(token, key, dto), id, dto);
	}
	@Post('mailboxes/:id/disconnect') @HttpCode(200) async disconnect(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailDisconnectDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.disconnect(await this.command(token, key, dto), id, dto);
	}
	@Get('contacts/:id/messages') async contactMessages(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.contactMessages(
			await this.mail.authority(token, query.workspaceId),
			id,
			query
		);
	}
	@Get('messages') @Header('Cache-Control', 'no-store') async messages(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailMessagesQuery
	) {
		const a = await this.mail.authority(token, query.workspaceId);
		const result = await this.mail.messages(a, query);
		if (
			JSON.stringify(await this.mail.authority(token, query.workspaceId)) !==
			JSON.stringify(a)
		)
			throw new ForbiddenException();
		return result;
	}

	@Get('messages/:id') @Header('Cache-Control', 'no-store') async message(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailMessageQuery,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.message(
			await this.mail.authority(token, query.workspaceId),
			id,
			undefined,
			query.bodyFormat
		);
	}
	@Get('mailboxes/:id/unmatched') async unmatched(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.unmatched(
			await this.mail.authority(token, query.workspaceId),
			id,
			query
		);
	}
	@Get('mailboxes/:mailboxId/unmatched/:messageId') async unmatchedDetail(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('mailboxId', new ParseUUIDPipe({ version: '4' })) mailboxId: string,
		@Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string
	) {
		return this.mail.message(
			await this.mail.authority(token, query.workspaceId),
			messageId,
			mailboxId
		);
	}

	@Post('messages/:id/link') @HttpCode(200) async link(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailLinkDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.link(await this.command(token, key, dto), id, dto);
	}
	@Post('attachments')
	@HttpCode(200)
	@UseGuards(MailUploadScopeGuard)
	@UseInterceptors(
		FileInterceptor('file', {
			limits: {
				fileSize: MAIL_LIMITS.maxFileBytes,
				files: 1,
				fields: 5,
				fieldSize: 1024,
				// Busboy emits partsLimit at the closing boundary of the last allowed part.
				parts: 7
			}
		})
	)
	async upload(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Headers('x-mail-workspace-id') workspace: string,
		@Headers('x-mail-mailbox-id') mailbox: string,
		@Headers('x-mail-contact-id') contact: string | undefined,
		@Body() dto: MailUploadDto,
		@UploadedFile()
		file: {
			originalname: string;
			mimetype: string;
			buffer: Buffer;
			size: number;
		}
	) {
		if (
			dto.workspaceId !== workspace ||
			dto.mailboxId !== mailbox ||
			(dto.contactId ?? null) !== (contact ?? null)
		)
			throw new BadRequestException({ code: 'crm_mail_upload_scope_mismatch' });
		return this.mail.upload(await this.command(token, key, dto), dto, file);
	}
	@Post('attachments/:id/prepare') @HttpCode(200) async prepare(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailPrepareAttachmentDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.prepare(await this.command(token, key, dto), id, dto);
	}
	@Get('attachments/:id') async attachment(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.attachmentMetadata(
			await this.mail.authority(token, query.workspaceId),
			id
		);
	}
	@Get('attachments/:id/content') async content(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Res() response: Response
	) {
		const { file, bytes } = await this.mail.content(
			await this.mail.authority(token, query.workspaceId),
			id
		);
		response.set({
			'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.safeFileName)}`,
			'Content-Type': 'application/octet-stream',
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private,no-store',
			'Content-Length': String(bytes.length)
		});
		response.end(bytes);
	}
	@Post('send') @HttpCode(200) async send(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Body() dto: MailSendDto
	) {
		return this.mail.send(await this.command(token, key, dto), dto);
	}
	@Get('sends/:id') async sendStatus(
		@Headers('authorization') token: string | undefined,
		@Query() query: MailQueryDto,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string
	) {
		return this.mail.sendStatus(
			await this.mail.authority(token, query.workspaceId),
			id
		);
	}
}
