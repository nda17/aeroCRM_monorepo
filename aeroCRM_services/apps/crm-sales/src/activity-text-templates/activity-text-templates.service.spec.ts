import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { CrmSalesPrismaService } from "../prisma/crm-sales-prisma.service";
import type { SalesAccess, SalesAccessClient } from "../sales/sales-access";
import { ActivityTextTemplatesService } from "./activity-text-templates.service";
import type { SaveActivityTextTemplatesDto } from "./activity-text-templates.dto";

const workspaceId = "b531b13e-3624-4ec5-b66d-f24373b0b374";
const template = {
  id: "d6249dca-c181-4ed8-8f31-83c263a7459e",
  title: " Follow up ",
  body: " Hello\r\nthere ",
  archived: false,
};
const access = (patch: Partial<SalesAccess> = {}): SalesAccess =>
  ({
    workspaceId,
    subject: "actor-a",
    role: "OWNER",
    state: "ACTIVE",
    permissions: ["sales:read", "sales:write"],
    ...patch,
  }) as SalesAccess;
const command = (patch: Partial<SaveActivityTextTemplatesDto> = {}) =>
  ({
    schemaVersion: 1,
    workspaceId,
    commandId: "b1c1d3d9-dc5a-4a50-98ba-c79b3895db62",
    expectedVersion: 0,
    templates: [template],
    ...patch,
  }) as SaveActivityTextTemplatesDto;

const harness = (authorized = access()) => {
  let row: { version: number; templates: unknown } | null = null;
  const receipts = new Map<string, Record<string, unknown>>();
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    activityTextTemplateSettings: {
      findUnique: jest.fn(async () => row),
      create: jest.fn(
        async ({ data }: { data: { version: number; templates: unknown } }) => {
          row = { version: data.version, templates: data.templates };
          return row;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { version: number };
          data: { version: { increment: number }; templates: unknown };
        }) => {
          if (!row || row.version !== where.version) return { count: 0 };
          row = {
            version: row.version + data.version.increment,
            templates: data.templates,
          };
          return { count: 1 };
        },
      ),
    },
    activityTextTemplateCommand: {
      findUnique: jest.fn(
        async ({ where }: { where: { commandId: string } }) =>
          receipts.get(where.commandId) ?? null,
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Record<string, unknown> & { commandId: string };
        }) => {
          receipts.set(data.commandId, data);
          return data;
        },
      ),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (run: (client: typeof tx) => unknown) =>
      run(tx),
    ),
  } as unknown as CrmSalesPrismaService;
  const accessClient = {
    authorize: jest.fn().mockResolvedValue(authorized),
  } as unknown as SalesAccessClient;
  return {
    service: new ActivityTextTemplatesService(prisma, accessClient),
    prisma,
    accessClient,
    tx,
    receipts,
    read: () => row,
  };
};

describe("ActivityTextTemplatesService", () => {
  it("normalizes content, stores a versioned snapshot, and replays an identical command", async () => {
    const h = harness();
    const saved = await h.service.save(access(), command(), "token");
    expect(saved).toEqual({
      schemaVersion: 1,
      workspaceId,
      version: 1,
      templates: [
        {
          id: template.id,
          title: "Follow up",
          body: "Hello\nthere",
          archived: false,
        },
      ],
    });
    expect(h.receipts.size).toBe(1);
    await expect(h.service.save(access(), command(), "token")).resolves.toEqual(
      saved,
    );
    expect(h.tx.activityTextTemplateSettings.create).toHaveBeenCalledTimes(1);
    expect(h.tx.activityTextTemplateCommand.create).toHaveBeenCalledTimes(1);
  });

  it("uses compare-and-swap and requires archive instead of deleting an existing template", async () => {
    const h = harness();
    await h.service.save(access(), command(), "token");
    await expect(
      h.service.save(
        access(),
        command({ commandId: "c1c1d3d9-dc5a-4a50-98ba-c79b3895db62" }),
        "token",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      h.service.save(
        access(),
        command({
          commandId: "c2c1d3d9-dc5a-4a50-98ba-c79b3895db62",
          templates: [],
          expectedVersion: 1,
        }),
        "token",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const archived = await h.service.save(
      access(),
      command({
        commandId: "c3c1d3d9-dc5a-4a50-98ba-c79b3895db62",
        expectedVersion: 1,
        templates: [{ ...template, archived: true }],
      }),
      "token",
    );
    expect(archived.version).toBe(2);
    expect(archived.templates[0].archived).toBe(true);
    expect(h.read()?.templates).toEqual(archived.templates);
  });

  it("rejects command replay with a different request hash or actor", async () => {
    const h = harness();
    await h.service.save(access(), command(), "token");
    await expect(
      h.service.save(
        access(),
        command({ templates: [{ ...template, title: "Different" }] }),
        "token",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const receipt = h.receipts.get(command().commandId)!;
    h.receipts.set(command().commandId, {
      ...receipt,
      actorSubject: "actor-b",
    });
    await expect(
      h.service.save(access(), command(), "token"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("allows ACTIVE and GRACE administrators while excluding analysts and non-admin writers", async () => {
    const grace = access({ state: "GRACE" });
    const h = harness(grace);
    await expect(h.service.settings(grace, workspaceId)).resolves.toMatchObject(
      { version: 0 },
    );
    await expect(
      h.service.save(grace, command(), "token"),
    ).resolves.toMatchObject({ version: 1 });
    await expect(
      h.service.settings(access({ role: "ANALYST" }), workspaceId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.service.save(access({ role: "MANAGER" }), command(), "token"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.service.save(access({ state: "READ_ONLY" }), command(), "token"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
