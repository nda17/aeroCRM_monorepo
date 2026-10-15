import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	ArrayUnique,
	Equals,
	IsArray,
	IsBoolean,
	IsDefined,
	IsInt,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	Validate,
	ValidateIf,
	ValidateNested,
	ValidatorConstraint,
	type ValidatorConstraintInterface
} from 'class-validator';
import { SalesAssignmentAssigneeDto } from './sales-assignment.dto';
import { TransitionDealDto, WorkspaceQuery } from './sales.dto';

const SINGLE_LINE = /^(?=.*\S)[^\x00-\x1f\x7f]+$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

@ValidatorConstraint({ name: 'nullableMembershipId', async: false })
class NullableMembershipId implements ValidatorConstraintInterface {
	validate(value: unknown) {
		return value === null || (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
	}
}

@ValidatorConstraint({ name: 'requiredNullableLossReason', async: false })
class RequiredNullableLossReason implements ValidatorConstraintInterface {
	validate(value: unknown) {
		return value === null || (!!value && typeof value === 'object' && !Array.isArray(value));
	}
}

@ValidatorConstraint({ name: 'uniqueLossReasons', async: false })
class UniqueLossReasons implements ValidatorConstraintInterface {
	validate(value: unknown) {
		if (!Array.isArray(value)) return false;
		const ids = value.map(item => item?.id?.toLowerCase());
		const titles = value.map(item => item?.title?.trim()?.toLocaleLowerCase('en-US'));
		return new Set(ids).size === ids.length && new Set(titles).size === titles.length;
	}
}

export class LossReasonDto {
	@IsDefined() @IsUUID('4') id!: string;
	@IsDefined() @IsString() @MinLength(1) @MaxLength(200) @Matches(SINGLE_LINE) title!: string;
	@IsDefined() @IsBoolean() archived!: boolean;
}

export class SaveLossReasonsDto {
	@IsDefined() @Equals(1) schemaVersion!: 1;
	@IsDefined() @IsUUID('4') workspaceId!: string;
	@IsDefined() @IsUUID('4') commandId!: string;
	@Validate(NullableMembershipId) actorMembershipId!: string | null;
	@IsDefined() @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
	@IsDefined() @IsArray() @ArrayMaxSize(50) @Validate(UniqueLossReasons)
	@ValidateNested({ each: true }) @Type(() => LossReasonDto)
	reasons!: LossReasonDto[];
}

export class LossReasonReferenceDto {
	@IsDefined() @IsUUID('4') id!: string;
	@IsDefined() @IsInt() @Min(0) @Max(2147483646) settingsVersion!: number;
}

export class TransitionDealV2Dto extends TransitionDealDto {
	@Validate(NullableMembershipId) actorMembershipId!: string | null;
	@Validate(RequiredNullableLossReason)
	@ValidateIf((_object, value) => value !== null)
	@ValidateNested() @Type(() => LossReasonReferenceDto)
	lossReason!: LossReasonReferenceDto | null;
}

export class BulkAssignmentDealDto {
	@IsDefined() @IsUUID('4') id!: string;
	@IsDefined() @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}

export class BulkAssignmentPreviewDto {
	@IsDefined() @Equals(1) schemaVersion!: 1;
	@IsDefined() @IsUUID('4') workspaceId!: string;
	@Validate(NullableMembershipId) actorMembershipId!: string | null;
	@IsDefined() @ValidateNested() @Type(() => SalesAssignmentAssigneeDto)
	assignee!: SalesAssignmentAssigneeDto;
	@IsDefined() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(25) @ArrayUnique(item => item.id)
	@ValidateNested({ each: true }) @Type(() => BulkAssignmentDealDto)
	deals!: BulkAssignmentDealDto[];
}

export class BulkAssignmentApplyDto extends BulkAssignmentPreviewDto {
	@IsDefined() @IsUUID('4') commandId!: string;
	@IsDefined() @IsString() @Matches(/^[0-9a-f]{64}$/) previewHash!: string;
}

export class LossReportQuery extends WorkspaceQuery {
	@ValidateIf((_object, value) => value !== undefined)
	@IsUUID('4') pipelineId?: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString() @Matches(UTC_MILLIS) lostFrom?: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString() @Matches(UTC_MILLIS) lostTo?: string;
}
