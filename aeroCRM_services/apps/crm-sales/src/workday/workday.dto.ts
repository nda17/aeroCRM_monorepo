import { Type } from 'class-transformer';
import {
	IsDefined,
	IsIn,
	IsInt,
	IsString,
	IsUUID,
	Matches,
	MaxLength,
	Min,
	MinLength,
	ValidateIf,
	ValidateNested,
	Validate,
	ValidatorConstraint,
	type ValidationArguments,
	type ValidatorConstraintInterface
} from 'class-validator';
import {
	SalesCommandDto,
	SalesListQuery,
	VersionedSalesCommand
} from '../sales/sales.dto';

const optional = (_object: unknown, value: unknown) => value !== undefined;
const columnIdPattern =
	/^(OPEN|IN_PROGRESS|COMPLETED|CANCELLED|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

@ValidatorConstraint({ name: 'plannerColumnFilterPair', async: false })
class PlannerColumnFilterPairConstraint implements ValidatorConstraintInterface {
	validate(_value: unknown, args: ValidationArguments) {
		const query = args.object as WorkdayQuery;
		return (
			(query.columnId === undefined) ===
			(query.settingsVersion === undefined)
		);
	}
}

export class TaskAssigneeDto {
	@IsString() @Matches(/^[^\s\x00-\x1f\x7f]{1,256}$/) subject!: string;
	@IsUUID('4') membershipId!: string;
}
export class CreateWorkdayTaskDto extends SalesCommandDto {
	@IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) title!: string;
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	dueAt!: string;
	@ValidateIf(optional) @IsUUID('4') dealId?: string;
	@ValidateIf(optional) @IsUUID('4') teamId?: string;
	// The selector defaults to the creator's current directory binding.
	@IsDefined()
	@ValidateNested()
	@Type(() => TaskAssigneeDto)
	assignee!: TaskAssigneeDto;
}
export class EditWorkdayTaskDto extends VersionedSalesCommand {
	@IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) title!: string;
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	dueAt!: string;
}
export class SetTaskStatusDto extends VersionedSalesCommand {
	@IsIn(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) status!:
		| 'OPEN'
		| 'IN_PROGRESS'
		| 'COMPLETED'
		| 'CANCELLED';
}
export class MoveWorkdayTaskDto extends VersionedSalesCommand {
	@IsString() @Matches(columnIdPattern) columnId!: string;
	@IsInt() @Min(0) settingsVersion!: number;
}
export class AssignWorkdayTaskDto extends VersionedSalesCommand {
	@IsDefined()
	@ValidateNested()
	@Type(() => TaskAssigneeDto)
	assignee!: TaskAssigneeDto;
}
export class WorkdayQuery extends SalesListQuery {
	@IsIn(['MINE', 'TEAM', 'ALL'])
	@Validate(PlannerColumnFilterPairConstraint)
	scope: 'MINE' | 'TEAM' | 'ALL' = 'MINE';
	@ValidateIf(optional) @IsUUID('4') teamId?: string;
	@ValidateIf(optional)
	@IsString()
	@Matches(/^[^\s\x00-\x1f\x7f]{1,256}$/)
	assigneeSubject?: string;
	@IsIn(['TODAY', 'TOMORROW', 'WEEK', 'DAY', 'RANGE', 'ALL', 'OVERDUE'])
	period:
		| 'TODAY'
		| 'TOMORROW'
		| 'WEEK'
		| 'DAY'
		| 'RANGE'
		| 'ALL'
		| 'OVERDUE' = 'TODAY';
	@IsString() @MinLength(1) @MaxLength(100) timeZone = 'Europe/Moscow';
	@ValidateIf(optional)
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	from?: string;
	@ValidateIf(optional)
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	to?: string;
	@ValidateIf(optional)
	@IsIn(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ACTIVE'])
	status?: SetTaskStatusDto['status'] | 'ACTIVE';
	@ValidateIf(optional)
	@IsString()
	@Matches(columnIdPattern)
	columnId?: string;
	@ValidateIf(optional)
	@Type(() => Number)
	@IsInt()
	@Min(0)
	settingsVersion?: number;
}
