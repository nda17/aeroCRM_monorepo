import { Type } from 'class-transformer';
import { Equals, IsUUID } from 'class-validator';

export class ChatAttachmentQueryDto {
	@IsUUID('4') workspaceId!: string;
}

export class ChatAttachmentUploadDto {
	@Type(() => Number) @Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsUUID('4') commandId!: string;
}

export class ChatAttachmentDiscardDto {
	@Type(() => Number) @Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsUUID('4') commandId!: string;
}
