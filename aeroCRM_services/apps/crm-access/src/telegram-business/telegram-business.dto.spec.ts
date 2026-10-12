import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  TelegramConnectSessionCommandDto,
  TelegramCreateConnectSessionDto,
  TelegramReplyDto,
} from "./telegram-business.dto";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const commandId = "22222222-2222-4222-8222-222222222222";
const command = { schemaVersion: 1, workspaceId, commandId };

describe("Telegram Business request DTOs", () => {
  it("accepts one explicit command envelope and rejects invalid authority or versions", () => {
    expect(
      validateSync(plainToInstance(TelegramCreateConnectSessionDto, command)),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(TelegramCreateConnectSessionDto, {
          ...command,
          workspaceId: "not-a-workspace",
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(TelegramConnectSessionCommandDto, {
          ...command,
          expectedVersion: "0",
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("bounds reply text at the Telegram message limit", () => {
    expect(
      validateSync(
        plainToInstance(TelegramReplyDto, { ...command, text: "Привет" }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(TelegramReplyDto, {
          ...command,
          text: "x".repeat(4097),
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(plainToInstance(TelegramReplyDto, { ...command, text: "" }))
        .length,
    ).toBeGreaterThan(0);
  });
});
