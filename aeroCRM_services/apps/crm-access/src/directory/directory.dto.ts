import { Transform, Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export class DirectoryFieldsDto {
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(100)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  firstName!: string | null;
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(100)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  lastName!: string | null;
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(100)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  middleName!: string | null;
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(64)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  phone!: string | null;
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(254)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  email!: string | null;
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(100)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  position!: string | null;
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(100)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  department!: string | null;
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(20)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  extension!: string | null;
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(100)
  @Matches(/^(?!\s*$)[^\x00-\x1f\x7f]*$/)
  telegram!: string | null;
}

export class DirectoryQueryDto {
  @IsUUID("4") workspaceId!: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  includeArchived = false;
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  activeOnly = false;
}

export class DirectoryCommandDto {
  @Equals(1) schemaVersion!: 1;
  @IsUUID("4") workspaceId!: string;
  @IsUUID("4") commandId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}

export class UpdateDirectoryDto extends DirectoryCommandDto {
  @IsObject()
  @ValidateNested()
  @Type(() => DirectoryFieldsDto)
  fields!: DirectoryFieldsDto;
}
