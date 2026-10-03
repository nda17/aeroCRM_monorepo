import { Type } from 'class-transformer';
import {
	IsArray,
	IsBoolean,
	IsIn,
	IsInt,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min,
	MinLength,
	Validate,
	ValidateNested,
	ValidatorConstraint,
	Matches,
	type ValidatorConstraintInterface,
	type ValidationArguments
} from 'class-validator';
import { SalesCommandDto } from '../sales/sales.dto';

const statuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const nonBlank = /\S/;

export class PlannerTemplateDto {
	@IsUUID('4') id!: string;
	@IsString() @MinLength(1) @MaxLength(200) @Matches(nonBlank) title!: string;
	@IsBoolean() archived!: boolean;
}

export class PlannerColumnDto {
	@IsString()
	@Matches(
		/^(OPEN|IN_PROGRESS|COMPLETED|CANCELLED|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
	)
	id!: string;
	@IsString() @MinLength(1) @MaxLength(100) @Matches(nonBlank) name!: string;
	@IsIn(statuses) status!: (typeof statuses)[number];
	@IsBoolean() isDefault!: boolean;
	@IsBoolean() archived!: boolean;
}

@ValidatorConstraint({ name: 'plannerSettingsItems', async: false })
class PlannerSettingsItemsConstraint implements ValidatorConstraintInterface {
	validate(_value: unknown, args: ValidationArguments) {
		if (!args.object || typeof args.object !== 'object') return false;
		const settings = args.object as SavePlannerSettingsDto;
		const { templates, columns } = settings;
		if (
			!Array.isArray(templates) ||
			templates.length > 100 ||
			!Array.isArray(columns) ||
			columns.length < 4 ||
			columns.length > 50
		)
			return false;
		if (
			new Set(templates.map(item => item?.id?.toLowerCase())).size !==
				templates.length ||
			new Set(columns.map(item => item?.id?.toLowerCase())).size !==
				columns.length
		)
			return false;
		return (
			statuses.every(status =>
				columns.some(
					column =>
						column.id === status &&
						column.status === status &&
						column.isDefault &&
						!column.archived
				)
			) &&
			columns.every(column =>
				column.isDefault
					? column.id === column.status && !column.archived
					: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
							column.id
						)
			)
		);
	}
	defaultMessage() {
		return 'Planner settings items are invalid';
	}
}

export class SavePlannerSettingsDto extends SalesCommandDto {
	@IsInt()
	@Min(0)
	@Max(2147483647)
	@Validate(PlannerSettingsItemsConstraint)
	expectedVersion!: number;
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => PlannerTemplateDto)
	templates!: PlannerTemplateDto[];
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => PlannerColumnDto)
	columns!: PlannerColumnDto[];
}
