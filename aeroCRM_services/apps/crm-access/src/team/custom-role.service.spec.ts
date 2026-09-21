import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CrmCustomRoleService } from "./custom-role.service";
import type { TeamAuthority } from "./team.util";

const workspaceId = randomUUID();
const roleId = randomUUID();
const actor: TeamAuthority = {
  workspaceId,
  subject: "owner",
  role: "OWNER",
  state: "ACTIVE",
  permissions: ["access:manage-team"],
};
const roleRow = (patch = {}) => ({
  id: roleId,
  workspaceId,
  name: "Продажи",
  nameKey: "продажи",
  permissions: ["customers:read"],
  dataScope: "OWN",
  version: 2,
  archivedAt: null,
  createdAt: new Date("2026-09-05T00:00:00.000Z"),
  updatedAt: new Date("2026-09-05T00:00:00.000Z"),
  ...patch,
});
const command = (patch = {}) => ({
  schemaVersion: 1 as const,
  commandId: randomUUID(),
  workspaceId,
  name: "Продажи",
  permissions: ["customers:read"],
  dataScope: "OWN" as const,
  ...patch,
});
const updateCommand = (patch = {}) => ({
  ...command(patch),
  expectedVersion: 2,
});

const setup = (currentActor: TeamAuthority = actor) => {
  const prisma = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ count: 0n }]),
    crmCustomRole: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation(async ({ data }) =>
          roleRow({ ...data, version: 1 }),
        ),
      update: jest.fn().mockResolvedValue(roleRow({ version: 3 })),
    },
    crmWorkspaceMember: { count: jest.fn().mockResolvedValue(0) },
    crmTeamCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    crmTeamAudit: { create: jest.fn() },
  };
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  const auth = {
    authorize: jest.fn().mockResolvedValue(currentActor),
  };
  return {
    prisma,
    auth,
    service: new CrmCustomRoleService(prisma as never, auth as never),
  };
};

describe("CRM custom role catalog commands", () => {
  const originalFlag = process.env.CRM_ACCESS_CUSTOM_ROLES_ENABLED;
  beforeEach(() => {
    process.env.CRM_ACCESS_CUSTOM_ROLES_ENABLED = "true";
  });
  afterEach(() => {
    if (originalFlag === undefined)
      delete process.env.CRM_ACCESS_CUSTOM_ROLES_ENABLED;
    else process.env.CRM_ACCESS_CUSTOM_ROLES_ENABLED = originalFlag;
  });

  it("allows only an active owner to create a normalized Russian role with exact permissions", async () => {
    const { service, prisma } = setup();
    const dto = command({
      name: "  Елизавета  Роль ",
      permissions: ["intake:write", "intake:read"],
      dataScope: "TEAM",
    });
    await expect(service.create("Bearer owner", dto)).resolves.toMatchObject({
      schemaVersion: 1,
      role: expect.objectContaining({
        name: "Елизавета Роль",
        permissions: ["intake:read", "intake:write"],
        dataScope: "TEAM",
      }),
    });
    expect(prisma.crmCustomRole.create).toHaveBeenCalledWith({
      data: {
        workspaceId,
        name: "Елизавета Роль",
        nameKey: "елизаветароль",
        permissions: ["intake:read", "intake:write"],
        dataScope: "TEAM",
      },
    });
  });

  it.each([{ role: "CRM_ADMIN" }, { role: "MANAGER" }, { state: "READ_ONLY" }])(
    "rejects non-owner or read-only role management %j",
    async (patch) => {
      const { service, prisma } = setup({ ...actor, ...patch });
      await expect(
        service.create("Bearer user", command()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.crmCustomRole.create).not.toHaveBeenCalled();
    },
  );

  it.each(["елизавета", "Role", "<Роль>", "Роль\nтест"])(
    "rejects a name outside the Russian uppercase display-name contract: %s",
    async (name) => {
      const { service } = setup();
      await expect(
        service.create("Bearer owner", command({ name })),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it("rejects duplicate normalized names within the same workspace", async () => {
    const { service, prisma } = setup();
    prisma.crmCustomRole.findFirst.mockResolvedValue(roleRow());
    await expect(
      service.create("Bearer owner", command({ name: "  ПРОДАЖИ  " })),
    ).rejects.toMatchObject({ response: { code: "crm_role_name_conflict" } });
    expect(prisma.crmCustomRole.create).not.toHaveBeenCalled();
  });

  it("rejects incomplete write permissions before opening a command transaction", async () => {
    const { service, prisma } = setup();
    await expect(
      service.create(
        "Bearer owner",
        command({ permissions: ["customers:write"] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("enforces compare-and-swap versions for update and preserves the exact binding", async () => {
    const { service, prisma } = setup();
    prisma.crmCustomRole.findFirst.mockResolvedValue(roleRow({ version: 3 }));
    await expect(
      service.update(
        "Bearer owner",
        roleId,
        updateCommand({ name: "Новая роль" }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.crmCustomRole.update).not.toHaveBeenCalled();

    prisma.crmCustomRole.findFirst
      .mockResolvedValueOnce(roleRow({ version: 2 }))
      .mockResolvedValue(null);
    prisma.crmCustomRole.update.mockResolvedValue(
      roleRow({ name: "Новая роль", nameKey: "новаяроль", version: 3 }),
    );
    await expect(
      service.update(
        "Bearer owner",
        roleId,
        updateCommand({ name: "Новая роль" }),
      ),
    ).resolves.toMatchObject({ role: { id: roleId, version: 3 } });
    expect(prisma.crmCustomRole.update).toHaveBeenCalledWith({
      where: { id: roleId },
      data: {
        name: "Новая роль",
        nameKey: "новаяроль",
        permissions: ["customers:read"],
        dataScope: "OWN",
        version: { increment: 1 },
      },
    });
  });

  it("archives only an unassigned role at the expected version", async () => {
    const { service, prisma } = setup();
    prisma.crmCustomRole.findFirst.mockResolvedValue(roleRow({ version: 2 }));
    prisma.crmWorkspaceMember.count.mockResolvedValue(1);
    await expect(
      service.archive("Bearer owner", roleId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        workspaceId,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: "crm_role_in_use" } });
    expect(prisma.crmCustomRole.update).not.toHaveBeenCalled();

    prisma.crmWorkspaceMember.count.mockResolvedValue(0);
    prisma.crmCustomRole.update.mockResolvedValue(
      roleRow({ archivedAt: new Date(), version: 3 }),
    );
    await expect(
      service.archive("Bearer owner", roleId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        workspaceId,
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({ role: { id: roleId, version: 3 } });
  });

  it("fails closed when custom roles are disabled", async () => {
    process.env.CRM_ACCESS_CUSTOM_ROLES_ENABLED = "false";
    const { service } = setup();
    await expect(
      service.create("Bearer owner", command()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
