import { BadRequestException, Paramtype, ValidationPipe } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  CreateCustomRoleDto,
  RoleQueryDto,
  UpdateCustomRoleDto,
} from "./custom-role.dto";

const workspaceId = randomUUID();
const commandId = randomUUID();
const permissions = [
  "customers:read",
  "customers:write",
  "intake:read",
  "intake:write",
  "sales:read",
  "sales:write",
  "sales:analytics",
];

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
});

const parse = (
  value: unknown,
  metatype: new () => unknown,
  type: Paramtype = "body",
) => pipe.transform(value, { type, metatype });

const createCommand = (overrides = {}) => ({
  schemaVersion: 1,
  commandId,
  workspaceId,
  name: "Sales operator",
  permissions: [...permissions],
  dataScope: "TEAM",
  ...overrides,
});

describe("custom role DTO contracts", () => {
  it("accepts the complete create payload and preserves the exact command fields", async () => {
    await expect(parse(createCommand(), CreateCustomRoleDto)).resolves.toEqual(
      createCommand(),
    );
  });

  it("accepts an update with a positive CAS version", async () => {
    await expect(
      parse(
        {
          ...createCommand(),
          expectedVersion: 3,
        },
        UpdateCustomRoleDto,
      ),
    ).resolves.toEqual({ ...createCommand(), expectedVersion: 3 });
  });

  it("reuses the team query pagination and rejects client authority fields", async () => {
    await expect(
      parse({ workspaceId, page: "2", pageSize: "7" }, RoleQueryDto, "query"),
    ).resolves.toEqual({ workspaceId, page: 2, pageSize: 7 });
    await expect(
      parse({ workspaceId, role: "CRM_ADMIN" }, RoleQueryDto, "query"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    { schemaVersion: 2 },
    { commandId: "not-a-uuid" },
    { workspaceId: "not-a-uuid" },
    { name: "" },
    { name: "x".repeat(81) },
    { permissions: [] },
    { permissions: [...permissions, "customers:read"] },
    { permissions: ["customers:read", "customers:read"] },
    { permissions: ["billing:admin"] },
    { dataScope: "GLOBAL" },
    { unknown: true },
  ])("rejects malformed create payload %j", async (patch) => {
    await expect(
      parse(createCommand(patch), CreateCustomRoleDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    { expectedVersion: 0 },
    { expectedVersion: -1 },
    { expectedVersion: 1.5 },
    { expectedVersion: 2147483648 },
    { name: "" },
    { permissions: [] },
    { permissions: ["customers:read", "customers:read"] },
    { dataScope: "INVALID" },
    { unknown: true },
  ])("rejects malformed update payload %j", async (patch) => {
    await expect(
      parse(
        { ...createCommand(), expectedVersion: 1, ...patch },
        UpdateCustomRoleDto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
