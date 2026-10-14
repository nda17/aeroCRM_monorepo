import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { DealDetailQuery, DealListQuery } from "./sales.dto";
import { SetStageDurationLimitDto } from "../commerce/commerce.dto";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const commandId = "22222222-2222-4222-8222-222222222222";
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
});
const parse = <T>(
  value: object,
  metatype: new () => T,
  type: "body" | "query" = "body",
) => pipe.transform(value, { type, metatype });

describe("stage-duration request DTOs", () => {
  it("accepts opt-in list and detail queries and strict stage-overdue values", async () => {
    await expect(
      parse(
        { workspaceId, includeStageDuration: "true", stageOverdue: "true" },
        DealListQuery,
        "query",
      ),
    ).resolves.toMatchObject({
      includeStageDuration: "true",
      stageOverdue: "true",
    });
    await expect(
      parse({ workspaceId, stageOverdue: "false" }, DealListQuery, "query"),
    ).resolves.toMatchObject({ stageOverdue: "false" });
    await expect(
      parse(
        { workspaceId, includeStageDuration: "true" },
        DealDetailQuery,
        "query",
      ),
    ).resolves.toMatchObject({ includeStageDuration: "true" });
  });

  it("rejects ambiguous, unsupported, and out-of-scope opt-in query values", async () => {
    for (const stageOverdue of ["TRUE", "", null, true, "yes"])
      await expect(
        parse({ workspaceId, stageOverdue }, DealListQuery, "query"),
      ).rejects.toBeInstanceOf(BadRequestException);
    for (const includeStageDuration of ["false", "", null, true])
      await expect(
        parse({ workspaceId, includeStageDuration }, DealListQuery, "query"),
      ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ workspaceId, stageOverdue: "true" }, DealDetailQuery, "query"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requires explicit null or an integer stage limit from 1 through 3650 days", async () => {
    const command = {
      schemaVersion: 1,
      workspaceId,
      commandId,
      expectedVersion: 1,
    };
    await expect(
      parse({ ...command, limitDays: null }, SetStageDurationLimitDto),
    ).resolves.toMatchObject({ limitDays: null });
    for (const limitDays of [1, 3650])
      await expect(
        parse({ ...command, limitDays }, SetStageDurationLimitDto),
      ).resolves.toMatchObject({ limitDays });
    for (const value of [
      command,
      { ...command, limitDays: undefined },
      { ...command, limitDays: "30" },
      { ...command, limitDays: 0 },
      { ...command, limitDays: 3651 },
      { ...command, limitDays: 1.5 },
      { ...command, limitDays: null, surprise: true },
    ])
      await expect(
        parse(value, SetStageDurationLimitDto),
      ).rejects.toBeInstanceOf(BadRequestException);
  });
});
