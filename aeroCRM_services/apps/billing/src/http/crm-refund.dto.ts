import { Transform, Type } from 'class-transformer';
import {
	Equals,
	IsEnum,
	IsInt,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Matches,
	Min,
	MinLength,
	ValidateIf
} from 'class-validator';

export enum CrmRefundReviewStatus {
	PENDING = 'PENDING',
	REVIEWED = 'REVIEWED'
}

export enum CrmRefundVerificationStatus {
	PENDING = 'PENDING',
	VERIFIED = 'VERIFIED',
	REJECTED = 'REJECTED',
	FAILED = 'FAILED'
}

export class CrmRefundListQueryDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(1_000_000)
	page = 1;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit = 20;

	@ValidateIf((_object, value) => value !== undefined)
	@IsEnum(CrmRefundReviewStatus)
	reviewStatus?: CrmRefundReviewStatus;

	@ValidateIf((_object, value) => value !== undefined)
	@IsEnum(CrmRefundVerificationStatus)
	verificationStatus?: CrmRefundVerificationStatus;
}

export class CrmRefundCommandDto {
	@Equals(1)
	schemaVersion!: 1;

	@IsUUID('4')
	commandId!: string;

	@IsInt()
	@Min(1)
	@Max(2_147_483_645)
	expectedVersion!: number;
}

export class ReviewCrmRefundDto extends CrmRefundCommandDto {
	@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
	@IsString()
	@MinLength(1)
	@MaxLength(2_000)
	@Matches(/^[^\x00-\x09\x0B-\x1F\x7F]*$/)
	comment!: string;
}

export class RetryCrmRefundDto extends CrmRefundCommandDto {}
