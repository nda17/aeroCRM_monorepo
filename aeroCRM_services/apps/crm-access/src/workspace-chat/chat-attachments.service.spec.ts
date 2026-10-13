import { ChatAttachmentsService } from "./chat-attachments.service";

const closedAttachment = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  conversationId: "33333333-3333-4333-8333-333333333333",
  privateObjectKey:
    "messenger/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/file",
  version: 4,
  leaseOwner: "44444444-4444-4444-8444-444444444444",
};

function setup(
  options: {
    retentionEnabled?: boolean;
    claim?: (typeof closedAttachment)[];
    completed?: boolean;
    claimError?: Error;
  } = {},
) {
  if (options.retentionEnabled === undefined)
    delete process.env.CRM_ACCESS_RETENTION_ENABLED;
  else
    process.env.CRM_ACCESS_RETENTION_ENABLED = options.retentionEnabled
      ? "true"
      : "false";
  process.env.CRM_ACCESS_PROCESS_ROLE = "api";
  const statements: string[] = [];
  let claimedClosedRows = false;
  const prisma = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join(" ");
      statements.push(statement);
      if (statement.includes("claim_closed_chat_attachments")) {
        if (options.claimError) throw options.claimError;
        if (claimedClosedRows) return [];
        claimedClosedRows = true;
        return options.claim || [];
      }
      if (statement.includes("complete_closed_chat_attachment"))
        return [{ completed: options.completed ?? true }];
      return [];
    }),
  };
  const objects = {
    available: true,
    assertKey: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
    candidates: jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: undefined }),
  };
  const service = new ChatAttachmentsService(
    prisma as never,
    {} as never,
    objects as never,
  );
  return { service, prisma, objects, statements };
}

describe("ChatAttachmentsService retention sweep", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("keeps closed-workspace cleanup disabled by default and still sweeps ordinary expired objects", async () => {
    delete process.env.CRM_ACCESS_RETENTION_ENABLED;
    const { service, objects, statements } = setup();
    await service.sweep();
    expect(
      statements.some((sql) => sql.includes("claim_closed_chat_attachments")),
    ).toBe(false);
    expect(objects.candidates).toHaveBeenCalledTimes(1);
    expect(service.progress()).toMatchObject({
      closedRetentionEnabled: false,
      lastResult: {
        candidates: 0,
        deleted: 0,
        closedCandidates: 0,
        closedDeleted: 0,
        orphanDeleted: 0,
        failures: 0,
      },
      lastErrorCode: null,
      passes: 1,
    });
  });

  it("removes closed-workspace objects through the gated claim and lease completion path", async () => {
    const { service, prisma, objects, statements } = setup({
      retentionEnabled: true,
      claim: [closedAttachment],
    });
    await service.sweep();
    expect(
      statements.some((sql) => sql.includes("claim_closed_chat_attachments")),
    ).toBe(true);
    expect(
      statements.some((sql) => sql.includes("complete_closed_chat_attachment")),
    ).toBe(true);
    expect(objects.assertKey).toHaveBeenCalledWith(
      closedAttachment.privateObjectKey,
      closedAttachment.workspaceId,
      closedAttachment.conversationId,
    );
    expect(objects.remove).toHaveBeenCalledTimes(1);
    expect(service.progress()).toMatchObject({
      closedRetentionEnabled: true,
      lastResult: {
        closedCandidates: 1,
        closedDeleted: 1,
        failures: 0,
      },
      lastErrorCode: null,
      consecutiveFailures: 0,
      passes: 1,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("records a lost lease as partial failure and does not count it as deleted", async () => {
    const { service, objects } = setup({
      retentionEnabled: true,
      claim: [closedAttachment],
      completed: false,
    });
    await service.sweep();
    const failedPass = service.progress();
    await service.sweep();
    expect(objects.remove).toHaveBeenCalledTimes(1);
    expect(failedPass).toMatchObject({
      lastErrorCode: "CHAT_ATTACHMENT_SWEEP_PARTIAL",
      consecutiveFailures: 1,
      passes: 1,
      lastResult: {
        closedCandidates: 1,
        closedDeleted: 0,
        failures: 1,
      },
    });
    expect(service.progress()).toMatchObject({
      lastErrorCode: null,
      consecutiveFailures: 0,
      passes: 2,
      lastResult: { closedCandidates: 0, closedDeleted: 0, failures: 0 },
    });
  });

  it("keeps database error details out of progress status when claiming fails", async () => {
    const { service } = setup({
      retentionEnabled: true,
      claimError: new Error("sensitive row contents"),
    });
    await expect(service.sweep()).rejects.toThrow("sensitive row contents");
    expect(service.progress()).toMatchObject({
      lastErrorCode: "CHAT_ATTACHMENT_SWEEP_FAILED",
      consecutiveFailures: 1,
      passes: 0,
      lastResult: expect.objectContaining({ failures: 1 }),
    });
    expect(JSON.stringify(service.progress())).not.toContain(
      "sensitive row contents",
    );
  });
});
