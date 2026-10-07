import { Equals, IsUUID } from 'class-validator';

export class MailIntakeSourceDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsUUID('4') messageId!: string;
}
