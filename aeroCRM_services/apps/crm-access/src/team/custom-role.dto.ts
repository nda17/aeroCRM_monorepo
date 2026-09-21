import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { TeamQueryDto, VersionedTeamCommandDto } from "./team.dto";

const CUSTOM_ROLE_PERMISSIONS = [
  "customers:read",
  "customers:write",
  "intake:read",
  "intake:write",
  "sales:read",
  "sales:write",
  "sales:analytics",
] as const;

const CUSTOM_ROLE_SCOPES = ["OWN", "TEAM", "ALL"] as const;

export class RoleQueryDto extends TeamQueryDto {}

export class CreateCustomRoleDto {
  @Equals(1)
  schemaVersion!: 1;

  @IsUUID("4")
  commandId!: string;

  @IsUUID("4")
  workspaceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsIn(CUSTOM_ROLE_PERMISSIONS, { each: true })
  permissions!: string[];

  @IsIn(CUSTOM_ROLE_SCOPES)
  dataScope!: (typeof CUSTOM_ROLE_SCOPES)[number];
}

export class UpdateCustomRoleDto extends VersionedTeamCommandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsIn(CUSTOM_ROLE_PERMISSIONS, { each: true })
  permissions!: string[];

  @IsIn(CUSTOM_ROLE_SCOPES)
  dataScope!: (typeof CUSTOM_ROLE_SCOPES)[number];
}
