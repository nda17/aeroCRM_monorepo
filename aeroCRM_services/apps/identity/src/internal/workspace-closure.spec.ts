import { ConflictException, ForbiddenException } from "@nestjs/common";
import { IdentityInternalService } from "./internal.service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const closureId = "22222222-2222-4222-8222-222222222222";
const otherClosureId = "33333333-3333-4333-8333-333333333333";
const membershipId = "44444444-4444-4444-8444-444444444444";
const ownerSubject = "owner-user";
const requestedAt = "2026-09-23T12:00:00.000Z";
const envelope = {
  closureId,
  workspaceId,
  generation: "1" as const,
  ownerSubject,
  requestedAt,
};

function harness(
  options: {
    workspaceStatus?: string;
    ownerUserId?: string;
    user?: Record<string, unknown> | null;
    fence?: Record<string, unknown> | null;
  } = {},
) {
  let workspace = {
    id: workspaceId,
    status: options.workspaceStatus ?? "ACTIVE",
    type: "PERSONAL",
    personalOwnerUserId: options.ownerUserId ?? ownerSubject,
  };
  let fence: any = options.fence ?? null;
  const userFindFirst = jest
    .fn()
    .mockResolvedValue(
      options.user === undefined ? { id: ownerSubject } : options.user,
    );
  const ownerFindMany = jest
    .fn()
    .mockResolvedValue([
      { id: membershipId, userId: options.ownerUserId ?? ownerSubject },
    ]);
  const workspaceFindUnique = jest.fn(async () => workspace);
  const workspaceUpdate = jest.fn(
    async ({ data }: { data: { status: string } }) => {
      workspace = { ...workspace, ...data };
      return workspace;
    },
  );
  const fenceFindUnique = jest.fn(async () => fence);
  const fenceUpdate = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      fence = { workspaceId, ...data };
      return fence;
    },
  );
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    workspace: { findUnique: workspaceFindUnique, update: workspaceUpdate },
    workspaceMember: { findMany: ownerFindMany, updateMany: jest.fn() },
    workspaceInvitation: { updateMany: jest.fn() },
    workspaceClosureFence: {
      findUnique: fenceFindUnique,
      update: fenceUpdate,
    },
  };
  const prisma = {
    user: { findFirst: userFindFirst },
    workspace: { findUnique: workspaceFindUnique },
    workspaceMember: { findMany: ownerFindMany },
    workspaceClosureFence: { findUnique: fenceFindUnique },
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return {
    service: new IdentityInternalService(
      prisma as never,
      {} as never,
      {} as never,
    ),
    prisma,
    tx,
    workspace: () => workspace,
    fence: () => fence,
  };
}

describe("Identity workspace closure owner and fence binding", () => {
  it("rejects a changed canonical owner before reading the inactive workspace fence", async () => {
    const h = harness({
      workspaceStatus: "INACTIVE",
      ownerUserId: "replacement-owner",
    });
    await expect(
      h.service.closureOwnerContext({
        workspaceId,
        closureId,
        subject: ownerSubject,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.workspaceClosureFence.findUnique).not.toHaveBeenCalled();
  });

  it("fences the canonical active owner, replays the exact binding, and refuses another binding", async () => {
    const h = harness();
    const ack = await h.service.fenceWorkspace(envelope);
    expect(ack).toMatchObject({
      schemaVersion: 1,
      service: "identity",
      closureId,
      workspaceId,
      generation: "1",
      state: "FENCED",
      financialPendingCount: 0,
      priorDispatchCount: 0,
    });
    expect(
      h.tx.$executeRaw.mock.calls.some(([query]) =>
        String(query).includes("identity.assert_workspace_open"),
      ),
    ).toBe(true);
    expect(h.workspace().status).toBe("INACTIVE");
    expect(h.tx.workspaceInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId, status: "PENDING" },
        data: expect.objectContaining({ status: "REVOKED" }),
      }),
    );
    expect(h.tx.workspaceClosureFence.update).toHaveBeenCalledTimes(1);
    expect(h.tx.workspaceMember.findMany).toHaveBeenCalledTimes(1);
    expect(h.tx.workspaceMember.updateMany).not.toHaveBeenCalled();

    await expect(h.service.fenceWorkspace(envelope)).resolves.toEqual(ack);
    expect(h.tx.workspaceClosureFence.update).toHaveBeenCalledTimes(1);
    expect(h.tx.workspaceMember.findMany).toHaveBeenCalledTimes(1);
    expect(h.tx.workspaceMember.updateMany).not.toHaveBeenCalled();
    await expect(
      h.service.fenceWorkspace({ ...envelope, closureId: otherClosureId }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.workspaceClosureFence.update).toHaveBeenCalledTimes(1);
  });

  it("does not fence or deactivate a workspace after the canonical owner changes", async () => {
    const h = harness({ ownerUserId: "replacement-owner" });
    await expect(h.service.fenceWorkspace(envelope)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(h.tx.workspace.update).not.toHaveBeenCalled();
    expect(h.tx.workspaceClosureFence.update).not.toHaveBeenCalled();
    expect(h.tx.workspaceInvitation.updateMany).not.toHaveBeenCalled();
    expect(h.workspace().status).toBe("ACTIVE");
  });

  it("allows inactive owner context only for the persisted fence and an active user", async () => {
    const h = harness({
      workspaceStatus: "INACTIVE",
      fence: {
        workspaceId,
        closureId,
        generation: 1n,
        ownerSubject,
        fencedAt: new Date(requestedAt),
      },
    });
    await expect(
      h.service.closureOwnerContext({
        workspaceId,
        closureId,
        subject: ownerSubject,
      }),
    ).resolves.toMatchObject({
      workspaceStatus: "INACTIVE",
      membershipId,
      ownerSubject,
      closureId,
    });
    await expect(
      h.service.closureOwnerContext({
        workspaceId,
        closureId: otherClosureId,
        subject: ownerSubject,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    h.prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      h.service.closureOwnerContext({
        workspaceId,
        closureId,
        subject: ownerSubject,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: ownerSubject, status: "ACTIVE", deletedAt: null },
      select: { id: true },
    });
  });
});
