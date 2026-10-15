import { Type } from "class-transformer";
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
  Matches,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from "class-validator";

const nonBlank = /\S/;
const noControls = /^[^\u0000-\u001f\u007f]*$/;
const bodyControls = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

export class ActivityTextTemplateDto {
  @IsUUID("4") id!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(nonBlank)
  @Matches(noControls)
  title!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(nonBlank)
  @Matches(bodyControls)
  body!: string;
  @IsBoolean() archived!: boolean;
}

@ValidatorConstraint({ name: "activityTextTemplateItems", async: false })
class ActivityTextTemplateItemsConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const command = args.object as SaveActivityTextTemplatesDto;
    if (!Array.isArray(command.templates) || command.templates.length > 100)
      return false;
    const ids = command.templates.map((template) =>
      typeof template?.id === "string" ? template.id.toLowerCase() : null,
    );
    if (ids.some((id) => id === null)) return false;
    return new Set(ids).size === ids.length;
  }
  defaultMessage() {
    return "Activity text templates must be unique and contain at most 100 items";
  }
}

export class SaveActivityTextTemplatesDto {
  @IsIn([1]) schemaVersion!: 1;
  @IsUUID("4") workspaceId!: string;
  @IsUUID("4") commandId!: string;
  @IsInt()
  @Min(0)
  @Max(2147483646)
  expectedVersion!: number;
  @IsArray()
  @Validate(ActivityTextTemplateItemsConstraint)
  @ValidateNested({ each: true })
  @Type(() => ActivityTextTemplateDto)
  templates!: ActivityTextTemplateDto[];
}
