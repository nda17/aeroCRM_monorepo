import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayUnique,
	Equals,
	IsArray,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min
} from 'class-validator';

export class ChatMessagesV2QueryDto {
	@IsUUID('4') workspaceId!: string;
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(2_147_483_647)
	beforeSequence?: number;
	@Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class SendMessageV2Dto {
	@Equals(2) schemaVersion!: 2;
	@IsUUID('4') workspaceId!: string;
	@IsUUID('4') commandId!: string;
	@IsOptional() @IsString() @MaxLength(10000) text?: string;
	@IsArray()
	@ArrayMaxSize(10)
	@ArrayUnique()
	@IsUUID('4', { each: true })
	attachmentIds!: string[];
}
