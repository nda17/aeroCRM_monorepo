import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { DirectoryQueryDto, UpdateDirectoryDto } from "./directory.dto";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const fields = {
  firstName: null,
  lastName: null,
  middleName: null,
  phone: null,
  email: null,
  position: null,
  department: null,
  extension: null,
  telegram: null,
};
const command = {
  schemaVersion: 1,
  workspaceId,
  commandId: "22222222-2222-4222-8222-222222222222",
  expectedVersion: 1,
  fields,
};

describe("workspace directory DTOs", () => {
  it("accepts a complete nullable contact replacement and rejects a missing key or unknown property", () => {
    expect(
      validateSync(plainToInstance(UpdateDirectoryDto, command), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateDirectoryDto, {
          ...command,
          fields: { ...fields, phone: undefined },
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateDirectoryDto, {
          ...command,
          fields: { ...fields, extra: "unexpected" },
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).not.toHaveLength(0);
  });

  it("enforces bounded fields and strict query boolean conversion", () => {
    expect(
      validateSync(
        plainToInstance(UpdateDirectoryDto, {
          ...command,
          fields: { ...fields, email: "x".repeat(255) },
        }),
      ).length,
    ).toBeGreaterThan(0);
    const valid = plainToInstance(DirectoryQueryDto, {
      workspaceId,
      includeArchived: "false",
      activeOnly: "true",
      page: "2",
      pageSize: "100",
    });
    expect(valid).toMatchObject({
      includeArchived: false,
      activeOnly: true,
      page: 2,
      pageSize: 100,
    });
    const invalid = plainToInstance(DirectoryQueryDto, {
      workspaceId,
      includeArchived: "yes",
    });
    expect(validateSync(invalid).length).toBeGreaterThan(0);
  });
});
