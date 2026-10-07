import {
	BadRequestException,
	Body,
	CanActivate,
	Controller,
	ExecutionContext,
	Get,
	Header,
	Headers,
	HttpCode,
	Injectable,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Res,
	UploadedFile,
	UseGuards,
	UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
	ChatAttachmentDiscardDto,
	ChatAttachmentQueryDto,
	ChatAttachmentUploadDto
} from './chat-attachments.dto';
import { ChatAttachmentsService } from './chat-attachments.service';
const uuid = new ParseUUIDPipe({ version: '4' });
// Multer 2.3.0 forwards this Busboy setting; its published types omit it.
const chatMultipartOptions: NonNullable<
	Parameters<typeof FileInterceptor>[1]
> & {
	defParamCharset: 'utf8';
} = {
	defParamCharset: 'utf8',
	limits: { fileSize: 5242880, files: 1, fields: 3, fieldSize: 1024, parts: 5 }
};

@Injectable()
export class ChatUploadScopeGuard implements CanActivate {
	constructor(private readonly attachments: ChatAttachmentsService) {}
	async canActivate(context: ExecutionContext) {
		const request = context.switchToHttp().getRequest<Request>();
		const workspace = request.header('x-chat-workspace-id');
		if (
			!workspace ||
			!/^[0-9a-f-]{36}$/i.test(workspace) ||
			!/^[0-9a-f-]{36}$/i.test(String(request.params.id))
		)
			throw new BadRequestException('Upload scope required');
		await this.attachments.preflight(
			request.header('authorization'),
			workspace,
			String(request.params.id)
		);
		return true;
	}
}
@Controller('crm/access/chat')
export class ChatAttachmentsController {
	constructor(private readonly attachments: ChatAttachmentsService) {}
	@Get('attachments/capabilities')
	@Header('Cache-Control', 'no-store')
	capabilities(
		@Headers('authorization') token: string | undefined,
		@Query() dto: ChatAttachmentQueryDto
	) {
		return this.attachments.capabilities(token, dto.workspaceId);
	}
	@Get('attachments/commands/:commandId')
	@Header('Cache-Control', 'no-store')
	lookup(
		@Headers('authorization') token: string | undefined,
		@Param('commandId', uuid) id: string,
		@Query() dto: ChatAttachmentQueryDto
	) {
		return this.attachments.lookup(token, dto.workspaceId, id);
	}
	@Post('conversations/:id/attachments')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@UseGuards(ChatUploadScopeGuard)
	@UseInterceptors(FileInterceptor('file', chatMultipartOptions))
	upload(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Headers('x-chat-workspace-id') workspace: string,
		@Param('id', uuid) id: string,
		@Body() dto: ChatAttachmentUploadDto,
		@UploadedFile()
		file: { buffer: Buffer; originalname: string; mimetype: string }
	) {
		if (key !== dto.commandId || workspace !== dto.workspaceId)
			throw new BadRequestException('Upload scope or command mismatch');
		return this.attachments.upload(token, id, dto, file);
	}
	@Post('attachments/:id/discard')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	discard(
		@Headers('authorization') token: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Param('id', uuid) id: string,
		@Body() dto: ChatAttachmentDiscardDto
	) {
		if (key !== dto.commandId)
			throw new BadRequestException('Command mismatch');
		return this.attachments.discard(token, id, dto);
	}
	@Get('attachments/:id/content') async content(
		@Headers('authorization') token: string | undefined,
		@Param('id', uuid) id: string,
		@Query() dto: ChatAttachmentQueryDto,
		@Res() response: Response
	) {
		const { row, bytes } = await this.attachments.content(
			token,
			dto.workspaceId,
			id
		);
		response.set({
			'Content-Type': row.detectedMime,
			'Content-Length': String(bytes.length),
			'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(row.fileName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		});
		response.send(bytes);
	}
}
