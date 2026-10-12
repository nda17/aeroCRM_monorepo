import { Type } from "class-transformer";
import { Equals, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class MessengerMessagesV3QueryDto {
  @IsUUID("4") workspaceId!: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  beforeSequence?: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class MessengerReadV3Dto {
  @Equals(3) schemaVersion!: 3;
  @IsUUID("4") workspaceId!: string;
  @IsUUID("4") commandId!: string;
  @IsInt()
  @Min(0)
  @Max(2147483647)
  throughSequence!: number;
}
