import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  MessengerMessagesV3QueryDto,
  MessengerReadV3Dto,
} from "./workspace-messenger.dto";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const commandId = "22222222-2222-4222-8222-222222222222";

describe("workspace messenger v3 DTOs", () => {
  it("transforms bounded sequence pagination and rejects invalid limits", () => {
    const query = plainToInstance(MessengerMessagesV3QueryDto, {
      workspaceId,
      beforeSequence: "40",
      limit: "50",
    });
    expect(validateSync(query)).toHaveLength(0);
    expect(query.beforeSequence).toBe(40);
    expect(query.limit).toBe(50);
    expect(
      validateSync(
        plainToInstance(MessengerMessagesV3QueryDto, {
          workspaceId,
          limit: "101",
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("accepts v3 read commands and rejects v1-shaped commands", () => {
    const valid = {
      schemaVersion: 3,
      workspaceId,
      commandId,
      throughSequence: 12,
    };
    expect(
      validateSync(plainToInstance(MessengerReadV3Dto, valid)),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(MessengerReadV3Dto, { ...valid, schemaVersion: 1 }),
      ).length,
    ).toBeGreaterThan(0);
  });
});
