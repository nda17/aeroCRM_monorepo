import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	ArrayUnique,
	Equals,
	IsArray,
	IsIn,
	IsInt,
	IsObject,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	Validate,
	ValidateNested,
	ValidationArguments,
	ValidatorConstraint,
	ValidatorConstraintInterface
} from 'class-validator';

export type SavedViewScope = 'DEALS' | 'TASKS';

@ValidatorConstraint({ name: 'savedViewFeature', async: false })
class SavedViewFeatureConstraint implements ValidatorConstraintInterface {
	validate(value: unknown, args: ValidationArguments) {
		if (value === undefined) return true;
		const scope = (args.object as { scope?: unknown }).scope;
		return value === 'stage-duration' && (scope === undefined || scope === 'DEALS');
	}
}

export class SavedViewsQueryDto {
	@IsUUID('4') workspaceId!: string;
	@IsIn(['DEALS', 'TASKS']) scope!: SavedViewScope;
	@Validate(SavedViewFeatureConstraint)
	features?: 'stage-duration';
}

export class SavedViewCommandDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') commandId!: string;
	@IsUUID('4') workspaceId!: string;
	@Validate(SavedViewFeatureConstraint)
	features?: 'stage-duration';
}

export class CreateSavedViewDto extends SavedViewCommandDto {
	@IsIn(['DEALS', 'TASKS']) scope!: SavedViewScope;
	@IsString() @MinLength(1) @MaxLength(60) name!: string;
	@IsObject() parameters!: Record<string, unknown>;
}

export class RenameSavedViewDto extends SavedViewCommandDto {
	@IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
	@IsString() @MinLength(1) @MaxLength(60) name!: string;
}

export class DeleteSavedViewDto extends SavedViewCommandDto {
	@IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}

export class LegacySavedViewDto {
	@IsString() @Matches(/^[0-9a-f]{64}$/) legacyKey!: string;
	@IsString() @MinLength(1) @MaxLength(60) name!: string;
	@IsObject() parameters!: Record<string, unknown>;
}

export class ImportSavedViewsDto extends SavedViewCommandDto {
	@IsIn(['DEALS', 'TASKS']) scope!: SavedViewScope;
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(10)
	@ArrayUnique((item: LegacySavedViewDto) => item.legacyKey)
	@ValidateNested({ each: true })
	@Type(() => LegacySavedViewDto)
	views!: LegacySavedViewDto[];
}
