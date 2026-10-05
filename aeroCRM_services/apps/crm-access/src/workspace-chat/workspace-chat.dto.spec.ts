import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  ChatQueryDto,
  NotificationQueryDto,
  SendMessageDto,
} from "./workspace-chat.dto";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const command = {
  schemaVersion: 1,
  workspaceId,
  commandId: "22222222-2222-4222-8222-222222222222",
};

describe("workspace chat DTOs", () => {
  it("accepts bounded message commands and rejects blank or oversized text", () => {
    expect(
      validateSync(
        plainToInstance(SendMessageDto, { ...command, text: " hello " }),
      ).length,
    ).toBe(0);
    expect(
      validateSync(plainToInstance(SendMessageDto, { ...command, text: "" }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(SendMessageDto, {
          ...command,
          text: "x".repeat(10001),
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("bounds pagination and parses only explicit notification booleans", () => {
    const chat = plainToInstance(ChatQueryDto, {
      workspaceId,
      page: "3",
      pageSize: "50",
    });
    expect(validateSync(chat).length).toBe(0);
    expect(
      validateSync(plainToInstance(ChatQueryDto, { workspaceId, page: "0" }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      plainToInstance(NotificationQueryDto, {
        workspaceId,
        unreadOnly: "false",
      }).unreadOnly,
    ).toBe(false);
    expect(
      validateSync(
        plainToInstance(NotificationQueryDto, {
          workspaceId,
          unreadOnly: "no",
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
});
