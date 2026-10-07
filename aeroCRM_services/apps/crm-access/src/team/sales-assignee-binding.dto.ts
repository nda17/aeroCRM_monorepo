import {
	Equals,
	IsOptional,
	IsString,
	IsUUID,
	Matches
} from 'class-validator';

export class ResolveSalesAssigneeDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsString() @Matches(/^[^\s\x00-\x1f\x7f]{1,256}$/) subject!: string;
	@IsOptional() @IsUUID('4') teamId?: string;
}
