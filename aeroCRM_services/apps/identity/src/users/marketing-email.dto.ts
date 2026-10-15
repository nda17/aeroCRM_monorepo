import {
	Equals,
	IsBoolean,
	IsHexadecimal,
	IsInt,
	IsString,
	IsUUID,
	Length,
	Max,
	Min,
	ValidateIf
} from 'class-validator';

export class MarketingEmailCommandDto {
	@Equals(1)
	schemaVersion!: 1;

	@IsUUID('4')
	commandId!: string;

	@IsInt()
	@Min(0)
	@Max(2_147_483_646)
	expectedVersion!: number;

	@ValidateIf((_object, value) => value !== null)
	@IsString()
	@IsHexadecimal()
	@Length(64, 64)
	expectedEmailBinding!: string | null;

	@IsBoolean()
	enabled!: boolean;

	@IsString()
	@Length(1, 64)
	consentTextVersion!: string;
}
