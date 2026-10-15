import { Type } from "class-transformer";
import {
  ArrayMaxSize,
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
  ValidateNested,
} from "class-validator";

const SINGLE_LINE_TEXT = /^(?=.*\S)[^\x00-\x1f\x7f]+$/;
const MULTILINE_TEXT = /^(?=.*\S)[^\x00-\x09\x0b\x0c\x0e-\x1f\x7f]+$/;

export class MailTemplateDto {
  @IsDefined()
  @IsUUID("4")
  id!: string;

  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(SINGLE_LINE_TEXT)
  title!: string;

  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  @Matches(SINGLE_LINE_TEXT)
  subject!: string;

  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(MULTILINE_TEXT)
  body!: string;

  @IsDefined()
  @IsBoolean()
  archived!: boolean;
}

export class SaveMailTemplatesDto {
  @IsDefined()
  @Equals(1)
  schemaVersion!: 1;

  @IsDefined()
  @IsUUID("4")
  workspaceId!: string;

  @IsDefined()
  @IsUUID("4")
  commandId!: string;

  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(2147483646)
  expectedVersion!: number;

  @IsDefined()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MailTemplateDto)
  templates!: MailTemplateDto[];
}
