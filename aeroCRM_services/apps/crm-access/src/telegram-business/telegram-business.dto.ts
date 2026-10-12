import { Type } from "class-transformer";
import {
  Equals,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class TelegramWorkspaceQueryDto {
  @IsUUID("4") workspaceId!: string;
}

export class TelegramCommandDto {
  @Equals(1) schemaVersion!: 1;
  @IsUUID("4") workspaceId!: string;
  @IsUUID("4") commandId!: string;
}

export class TelegramCreateConnectSessionDto extends TelegramCommandDto {
  @IsOptional() @IsUUID("4") channelId?: string;
}

export class TelegramConnectSessionCommandDto extends TelegramCommandDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
}

export class TelegramDisconnectChannelDto extends TelegramConnectSessionCommandDto {}

export class TelegramReplyDto extends TelegramCommandDto {
  @IsString() @MinLength(1) @MaxLength(4096) text!: string;
}
