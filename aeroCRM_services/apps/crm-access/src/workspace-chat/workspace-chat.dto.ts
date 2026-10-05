import { Transform, Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class ChatQueryDto {
  @IsUUID("4") workspaceId!: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
}

export class MessageQueryDto {
  @IsUUID("4") workspaceId!: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  beforeSequence?: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class ChatCommandDto {
  @Equals(1) schemaVersion!: 1;
  @IsUUID("4") workspaceId!: string;
  @IsUUID("4") commandId!: string;
}

export class DirectChatDto extends ChatCommandDto {
  @IsString() @MinLength(1) @MaxLength(256) recipientSubject!: string;
}
export class SendMessageDto extends ChatCommandDto {
  @IsString() @MinLength(1) @MaxLength(10000) text!: string;
}
export class ReadChatDto extends ChatCommandDto {
  @IsInt() @Min(0) @Max(2147483647) throughSequence!: number;
}

export class NotificationQueryDto {
  @IsUUID("4") workspaceId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  unreadOnly = false;
}
