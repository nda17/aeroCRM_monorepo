import {
	Equals,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min
} from 'class-validator';

export class CrmBootstrapQueryDto {
	@IsOptional()
	@IsUUID('4')
	workspaceId?: string;
}

export class ActivateCrmTrialDto {
	@IsInt()
	@Equals(1)
	schemaVersion!: 1;

	@IsUUID('4')
	commandId!: string;

	@IsUUID('4')
	workspaceId!: string;
}

export class InstallCrmPipelineTemplateDto {
	@IsInt()
	@Equals(1)
	schemaVersion!: 1;

	@IsUUID('4')
	commandId!: string;

	@IsUUID('4')
	workspaceId!: string;

	@IsString()
	@MaxLength(64)
	@Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	templateKey!: string;

	@IsInt()
	@Min(1)
	@Max(32_767)
	templateVersion!: number;
}
