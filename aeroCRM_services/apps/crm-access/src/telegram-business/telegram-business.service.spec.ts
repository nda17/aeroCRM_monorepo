import { NotFoundException } from "@nestjs/common";
import { TelegramBusinessService } from "./telegram-business.service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectSessionId = "22222222-2222-4222-8222-222222222222";
const sourceMessageId = "33333333-3333-4333-8333-333333333333";

function authorized(subject = "employee-a", membershipId = "member-current") {
  return {
    authorize: jest.fn().mockResolvedValue({
      workspaceId,
      subject,
      role: "OWNER",
      state: "ACTIVE",
      permissions: [],
    }),
    assignmentSubject: jest
      .fn()
      .mockResolvedValue({ membershipId, state: "ACTIVE" }),
  };
}

describe("Telegram Business actor and membership fences", () => {
  it("returns a live deep link only to the actor and membership that created the session", async () => {
    const row = {
      id: connectSessionId,
      workspaceId,
      actorSubject: "employee-a",
      actorMembershipId: "member-current",
      state: "WAITING_TELEGRAM",
      version: 1,
      expiresAt: new Date(Date.now() + 60_000),
      telegramUserId: null,
      ownerName: null,
      ownerUsername: null,
      channelId: null,
    };
    const prisma = {
      telegramConnectSession: { findFirst: jest.fn().mockResolvedValue(row) },
    };
    const service = new TelegramBusinessService(
      prisma as never,
      authorized() as never,
      {
        configured: true,
        secret: "synthetic",
        username: "crm_test_bot",
      } as never,
    );
    const response = await service.session(
      "Bearer synthetic",
      connectSessionId,
      workspaceId,
    );
    expect(response.subject).toBe("employee-a");
    expect(response.item.deepLink).toMatch(
      /^https:\/\/t\.me\/crm_test_bot\?start=/,
    );
  });

  it.each([
    { subject: "employee-b", membershipId: "member-current" },
    { subject: "employee-a", membershipId: "membership-after-rejoin" },
  ])(
    "hides a session from a different actor or replacement membership",
    async (binding) => {
      const row = {
        id: connectSessionId,
        workspaceId,
        actorSubject: "employee-a",
        actorMembershipId: "member-current",
        state: "WAITING_TELEGRAM",
        version: 1,
        expiresAt: new Date(Date.now() + 60_000),
        telegramUserId: null,
        ownerName: null,
        ownerUsername: null,
        channelId: null,
      };
      const service = new TelegramBusinessService(
        {
          telegramConnectSession: {
            findFirst: jest.fn().mockResolvedValue(row),
          },
        } as never,
        authorized(binding.subject, binding.membershipId) as never,
        {
          configured: true,
          secret: "synthetic",
          username: "crm_test_bot",
        } as never,
      );
      await expect(
        service.session("Bearer synthetic", connectSessionId, workspaceId),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it("expires a stale session without leaking a usable deep link", async () => {
    const row = {
      id: connectSessionId,
      workspaceId,
      actorSubject: "employee-a",
      actorMembershipId: "member-current",
      state: "WAITING_TELEGRAM",
      version: 2,
      expiresAt: new Date(Date.now() - 1_000),
      telegramUserId: null,
      ownerName: null,
      ownerUsername: null,
      channelId: null,
    };
    const service = new TelegramBusinessService(
      {
        telegramConnectSession: { findFirst: jest.fn().mockResolvedValue(row) },
      } as never,
      authorized() as never,
      {
        configured: true,
        secret: "synthetic",
        username: "crm_test_bot",
      } as never,
    );
    const response = await service.session(
      "Bearer synthetic",
      connectSessionId,
      workspaceId,
    );
    expect(response.item.state).toBe("EXPIRED");
    expect(response.item.deepLink).toBeNull();
  });

  it("does not allow an inbound reply source to be resolved outside the bound workspace", async () => {
    const tx = {
      $executeRaw: jest.fn(),
      crmTeamCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      telegramMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (value: unknown) => unknown) =>
        operation(tx),
      ),
    };
    const auth = authorized();
    const service = new TelegramBusinessService(
      prisma as never,
      auth as never,
      {
        configured: true,
        secret: "synthetic",
        username: "crm_test_bot",
      } as never,
    );
    await expect(
      service.reply("Bearer synthetic", sourceMessageId, {
        workspaceId,
        commandId: "44444444-4444-4444-8444-444444444444",
        text: "Ответ",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.telegramMessage.findFirst).toHaveBeenCalledWith({
      where: {
        id: sourceMessageId,
        workspaceId,
        direction: "INBOUND",
        origin: "CUSTOMER",
        deletedAt: null,
      },
    });
    expect(auth.assignmentSubject).toHaveBeenCalledWith(
      workspaceId,
      "employee-a",
    );
  });
});
