import {
	IsDateString,
	Equals,
	IsIn,
	IsInt,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Matches,
	Min,
	MinLength,
} from 'class-validator';

export class UpdateCrmCommercialPolicyDto {
	@Equals(1)
	schemaVersion!: 1;

	@IsUUID('4')
	commandId!: string;

	@IsInt()
	@Min(1)
	@Max(2_147_483_647)
	expectedVersion!: number;

	@IsInt()
	@Min(1)
	@Max(100_000_000)
	monthlyPriceMinor!: number;

	@IsInt()
	@Min(1)
	@Max(100_000_000)
	yearlyPriceMinor!: number;

	@IsInt()
	@Min(1)
	@Max(100_000_000)
	additionalSeatMonthlyPriceMinor!: number;

	@IsInt()
	@Min(1)
	@Max(100_000_000)
	additionalSeatYearlyPriceMinor!: number;

	@IsInt()
	@Min(2)
	@Max(10_000)
	includedSeats!: number;

	@IsInt()
	@Min(2)
	@Max(10_000)
	trialSeatLimit!: number;
}

export class RevokeEntitlementsCommandDto {
	@IsInt()
	@Equals(1)
	schemaVersion!: number;

	@IsUUID()
	commandId!: string;

	@IsString()
	userId!: string;

	@IsIn(['USER_DEACTIVATION', 'USER_SOFT_DELETE'])
	reason!: string;

	@IsString()
	actorId!: string;

	@IsIn(['ADMIN', 'DEV'])
	actorRole!: 'ADMIN' | 'DEV';

	@IsDateString()
	occurredAt!: string;
}

export class ActivateCrmTrialCommandDto {
	@IsInt()
	@Equals(1)
	schemaVersion!: number;

	@IsUUID('4')
	commandId!: string;

	@IsUUID('4')
	workspaceId!: string;

	@IsString()
	@MinLength(1)
	@MaxLength(256)
	@Matches(/^[A-Za-z0-9_-]+$/)
	activatedByUserId!: string;
}

export class BillingFailureCommandDto {
	@IsInt()
	@Equals(1)
	schemaVersion!: number;

	@IsUUID()
	commandId!: string;

	@IsString()
	actorId!: string;

	@IsIn(['ADMIN', 'DEV'])
	actorRole!: 'ADMIN' | 'DEV';

	@IsDateString()
	occurredAt!: string;
}

export class BillingFailureCloseCommandDto extends BillingFailureCommandDto {
	@IsString()
	@MinLength(3)
	@MaxLength(1000)
	comment!: string;
}
