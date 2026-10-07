import {
	Equals,
	IsEmail,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	MaxLength
} from 'class-validator';

export class MailIntakePreviewQueryDto {
	@IsUUID('4') workspaceId!: string;
	@IsUUID('4') messageId!: string;
}

export class MailIntakeCommandsQueryDto {
	@IsUUID('4') workspaceId!: string;
}

export class MailIntakeSourceQueryDto {
	@IsUUID('4') workspaceId!: string;
}

export class MailIntakeCreateDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsUUID('4') commandId!: string;
	@IsUUID('4') messageId!: string;
	@IsString() @Matches(/^[0-9a-f]{64}$/i) sourceHash!: string;
	@IsString() @MaxLength(200) @Matches(/\S/) title!: string;
	@IsString() @MaxLength(200) @Matches(/\S/) name!: string;
	@IsOptional() @Matches(/^\+[1-9][0-9]{6,14}$/) phone?: string | null;
	@IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
	@IsOptional() @IsString() @MaxLength(5000) message?: string | null;
	@IsOptional() @IsUUID('4') teamId?: string | null;
	@Equals(true) copyConfirmed!: true;
}
