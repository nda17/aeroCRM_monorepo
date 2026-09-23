import {
	Equals,
	IsISO8601,
	IsInt,
	IsString,
	IsUUID,
	MaxLength,
	MinLength,
	Matches
} from 'class-validator';

export class WorkspaceClosureCommandDto {
	@IsInt()
	@Equals(1)
	schemaVersion!: 1;

	@IsUUID('4')
	commandId!: string;

	@IsUUID('4')
	workspaceId!: string;

	@IsString()
	@Equals('0')
	expectedVersion!: '0';

	@IsString()
	@MinLength(1)
	@MaxLength(200)
	confirmationLabel!: string;
}

export class WorkspaceClosureFenceDto {
	@IsInt()
	@Equals(1)
	schemaVersion!: 1;

	@IsUUID('4')
	closureId!: string;

	@IsUUID('4')
	workspaceId!: string;

	@IsString()
	@Matches(/^[1-9][0-9]*$/)
	@Equals('1')
	generation!: '1';

	@IsString()
	@MinLength(1)
	@MaxLength(256)
	@Matches(/^[^\s\x00-\x1f\x7f]+$/)
	ownerSubject!: string;

	@IsString()
	@IsISO8601({ strict: true })
	requestedAt!: string;
}
