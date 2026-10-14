import { BadRequestException, ValidationPipe } from "@nestjs/common";
import {
  CreateSavedViewDto,
  RenameSavedViewDto,
  SavedViewsQueryDto,
} from "./saved-views.dto";

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

describe("saved-view feature DTOs", () => {
  it("accepts the stage-duration feature for DEALS reads and writes", async () => {
    await expect(
      parse(
        { workspaceId, scope: "DEALS", features: "stage-duration" },
        SavedViewsQueryDto,
        "query",
      ),
    ).resolves.toMatchObject({ features: "stage-duration" });
    await expect(
      parse(
        {
          schemaVersion: 1,
          workspaceId,
          commandId,
          scope: "DEALS",
          features: "stage-duration",
          name: "Мои сделки",
          parameters: {},
        },
        CreateSavedViewDto,
      ),
    ).resolves.toMatchObject({ features: "stage-duration" });
    await expect(
      parse(
        {
          schemaVersion: 1,
          workspaceId,
          commandId,
          expectedVersion: 1,
          features: "stage-duration",
          name: "Мои сделки",
        },
        RenameSavedViewDto,
      ),
    ).resolves.toMatchObject({ features: "stage-duration" });
  });

  it("rejects feature use for TASKS and malformed or explicit-null flags", async () => {
    await expect(
      parse(
        { workspaceId, scope: "TASKS", features: "stage-duration" },
        SavedViewsQueryDto,
        "query",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    for (const features of ["unknown", null, true])
      await expect(
        parse(
          { workspaceId, scope: "DEALS", features },
          SavedViewsQueryDto,
          "query",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
  });
});
