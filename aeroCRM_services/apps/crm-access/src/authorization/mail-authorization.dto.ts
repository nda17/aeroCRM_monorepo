import { Equals, IsIn, IsInt, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** Strict caller-to-worker authority request, separate from legacy CRM grants. */
export class MailWorkflowDto {
	@IsInt() @Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsString() @MaxLength(256) @Matches(/^[^\s\x00-\x1f\x7f]{1,256}$/) subject!: string;
	@IsUUID('4') membershipId!: string;
	@IsIn(['MAIL_SYNC', 'MAIL_SEND']) purpose!: 'MAIL_SYNC' | 'MAIL_SEND';
}
