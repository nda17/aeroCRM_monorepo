import { Type } from 'class-transformer';
import {
	Equals,
	IsDefined,
	IsInt,
	IsString,
	IsUUID,
	Matches,
	Max,
	Min,
	ValidateNested
} from 'class-validator';

export class SalesAssignmentAssigneeDto {
	@IsString() @Matches(/^[^\s\x00-\x1f\x7f]{1,256}$/) subject!: string;
	@IsUUID('4') membershipId!: string;
}

export class SalesAssignmentDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsUUID('4') commandId!: string;
	@IsInt() @Min(1) @Max(2_147_483_646) expectedVersion!: number;
	@IsDefined()
	@ValidateNested()
	@Type(() => SalesAssignmentAssigneeDto)
	assignee!: SalesAssignmentAssigneeDto;
}
