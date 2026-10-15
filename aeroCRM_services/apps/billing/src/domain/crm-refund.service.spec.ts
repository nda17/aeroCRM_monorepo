import { CrmRefundService } from "./crm-refund.service";

const ID = "11111111-1111-4111-8111-111111111111";
const COMMAND = "22222222-2222-4222-8222-222222222222";
const actor = {
  active: true,
  roles: ["ADMIN"],
  subject: "admin-subject",
  sessionId: "admin-session",
} as any;

function fixture(overrides: Record<string, unknown> = {}) {
  let row = {
    id: ID,
    version: 4,
    shopId: "shop-1",
    providerMode: "TEST",
    providerRefundId: "33333333-3333-4333-8333-333333333333",
    paymentIdHint: "44444444-4444-4444-8444-444444444444",
    providerPaymentId: "44444444-4444-4444-8444-444444444444",
    orderId: "55555555-5555-4555-8555-555555555555",
    workspaceId: "66666666-6666-4666-8666-666666666666",
    verificationStatus: "VERIFIED",
    reviewStatus: "PENDING",
    amountMinor: 9900n,
    currency: "RUB",
    providerCreatedAt: new Date("2026-10-15T10:00:00.000Z"),
    verifiedAt: new Date("2026-10-15T10:01:00.000Z"),
    attempts: 1,
    lastErrorCode: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewComment: null,
    createdAt: new Date("2026-10-15T09:00:00.000Z"),
    updatedAt: new Date("2026-10-15T10:01:00.000Z"),
    ...overrides,
  } as any;
  const receipt = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    crmRefundCommandReceipt: receipt,
    crmRefundReview: {
      findUnique: jest.fn(async () => row),
      findUniqueOrThrow: jest.fn(async () => row),
      findFirst: jest.fn(async () => row),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.version !== row.version) return { count: 0 };
        const version = data.version?.increment
          ? row.version + data.version.increment
          : row.version;
        const attempts = data.attempts?.increment
          ? row.attempts + data.attempts.increment
          : row.attempts;
        row = {
          ...row,
          ...data,
          version,
          attempts,
          updatedAt: new Date("2026-10-15T10:02:00.000Z"),
        };
        return { count: 1 };
      }),
    },
    crmOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: "55555555-5555-4555-8555-555555555555",
        workspaceId: "66666666-6666-4666-8666-666666666666",
        cycle: "MONTHLY",
        kind: "ONE_TIME",
        providerPaymentId: "44444444-4444-4444-8444-444444444444",
        amountMinor: 9900n,
        currency: "RUB",
        status: "SUCCEEDED",
      }),
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(async (work) => work(tx)),
    crmRefundReview: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
  const provider = {
    refundVerificationConfiguration: jest.fn(() => ({
      shopId: "shop-1",
      mode: "test",
    })),
  } as any;
  const identity = { introspect: jest.fn().mockResolvedValue(actor) } as any;
  const service = new CrmRefundService(prisma, provider, identity);
  return { service, prisma, provider, identity, tx, receipt, row: () => row };
}

const context = {
  actor,
  authorization: "Bearer synthetic-test-token",
  ip: "127.0.0.1",
  userAgent: "risk-controls-test",
};
const command = (changes: Record<string, unknown> = {}) => ({
  schemaVersion: 1 as const,
  commandId: COMMAND,
  expectedVersion: 4,
  comment: "Reviewed against provider records",
  ...changes,
});

describe("CrmRefundService", () => {
  it("rejects spoofed webhook source before persisting any refund evidence", async () => {
    const f = fixture();
    await expect(
      f.service.capture(
        {
          type: "notification",
          event: "refund.succeeded",
          object: {
            id: "33333333-3333-4333-8333-333333333333",
            payment_id: "44444444-4444-4444-8444-444444444444",
          },
        },
        "203.0.113.9",
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.prisma.crmRefundReview.createMany).not.toHaveBeenCalled();
    expect(f.provider.refundVerificationConfiguration).not.toHaveBeenCalled();
  });

  it("captures only the provider refund and payment identifiers from a trusted notification", async () => {
    const f = fixture();
    await expect(
      f.service.capture(
        {
          type: "notification",
          event: "refund.succeeded",
          object: {
            id: "33333333-3333-4333-8333-333333333333",
            payment_id: "44444444-4444-4444-8444-444444444444",
            amount: { value: "999999.00", currency: "RUB" },
            metadata: { workspaceId: "untrusted" },
          },
        },
        "185.71.76.1",
      ),
    ).resolves.toBe(true);
    expect(f.prisma.crmRefundReview.createMany).toHaveBeenCalledWith({
      data: [
        {
          shopId: "shop-1",
          providerMode: "TEST",
          providerRefundId: "33333333-3333-4333-8333-333333333333",
          paymentIdHint: "44444444-4444-4444-8444-444444444444",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("requires a fresh same-session administrator and only reviews verified pending refunds", async () => {
    const f = fixture({ verificationStatus: "PENDING" });
    await expect(
      f.service.command(ID, "REVIEW", command(), context),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.identity.introspect).toHaveBeenCalledWith(context.authorization);
    expect(f.tx.crmRefundReview.updateMany).not.toHaveBeenCalled();

    const changedIdentity = fixture();
    changedIdentity.identity.introspect.mockResolvedValue({
      ...actor,
      sessionId: "different-session",
    });
    await expect(
      changedIdentity.service.command(ID, "REVIEW", command(), context),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      changedIdentity.tx.crmRefundReview.updateMany,
    ).not.toHaveBeenCalled();
  });

  it("commits note, CAS version, receipt, and audit once; exact replay returns the saved result", async () => {
    const f = fixture();
    const first = await f.service.command(ID, "REVIEW", command(), context);
    expect(first).toMatchObject({
      version: 5,
      reviewStatus: "REVIEWED",
      reviewedBy: actor.subject,
      reviewComment: "Reviewed against provider records",
    });
    expect(f.tx.crmRefundReview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID, version: 4 } }),
    );
    expect(f.receipt.create).toHaveBeenCalledTimes(1);
    expect(f.tx.outboxEvent.create).toHaveBeenCalledTimes(1);

    f.receipt.findUnique.mockResolvedValue({
      commandType: "REVIEW",
      refundId: ID,
      requestHash: expect.any(String),
      result: first,
    });
    // The stored hash is computed in the same function and is available on the insert.
    const inserted = f.receipt.create.mock.calls[0][0].data;
    f.receipt.findUnique.mockResolvedValue({ ...inserted, result: first });
    await expect(
      f.service.command(ID, "REVIEW", command(), context),
    ).resolves.toEqual(first);
    expect(f.tx.crmRefundReview.updateMany).toHaveBeenCalledTimes(1);
    expect(f.receipt.create).toHaveBeenCalledTimes(1);
    expect(f.tx.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it("rejects command-id reuse when its note changes", async () => {
    const f = fixture();
    const first = await f.service.command(ID, "REVIEW", command(), context);
    const inserted = f.receipt.create.mock.calls[0][0].data;
    f.receipt.findUnique.mockResolvedValue({ ...inserted, result: first });
    await expect(
      f.service.command(
        ID,
        "REVIEW",
        command({ comment: "Different note" }),
        context,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.tx.crmRefundReview.updateMany).toHaveBeenCalledTimes(1);
  });

  it("surfaces a lost CAS race without writing a receipt or audit event", async () => {
    const f = fixture();
    f.tx.crmRefundReview.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      f.service.command(ID, "REVIEW", command(), context),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.receipt.create).not.toHaveBeenCalled();
    expect(f.tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it("allows a fresh actor-bound retry only for terminal verification failures", async () => {
    const failed = fixture({ verificationStatus: "FAILED", attempts: 7 });
    const retry = {
      schemaVersion: 1 as const,
      commandId: COMMAND,
      expectedVersion: 4,
    };
    await expect(
      failed.service.command(ID, "RETRY", retry, context),
    ).resolves.toMatchObject({ verificationStatus: "PENDING", version: 5 });
    expect(failed.tx.crmRefundReview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: "PENDING",
          attempts: 0,
          leaseToken: null,
          leaseUntil: null,
        }),
      }),
    );

    const pending = fixture({ verificationStatus: "PENDING" });
    await expect(
      pending.service.command(ID, "RETRY", retry, context),
    ).rejects.toMatchObject({ status: 409 });
    expect(pending.tx.crmRefundReview.updateMany).not.toHaveBeenCalled();
  });

  it("rejects provider/shop mode mismatch before fetching refund evidence", async () => {
    const f = fixture({
      verificationStatus: "PENDING",
      reviewStatus: "PENDING",
    });
    f.provider.refundVerificationConfiguration.mockReturnValue({
      shopId: "another-shop",
      mode: "test",
    });
    f.provider.getRefund = jest.fn();
    f.provider.getPayment = jest.fn();
    await expect(f.service.processOne()).resolves.toBe(true);
    expect(f.provider.getRefund).not.toHaveBeenCalled();
    expect(f.prisma.crmRefundReview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: "REJECTED",
          lastErrorCode: "REFUND_CONFIGURATION_MISMATCH",
        }),
      }),
    );
  });

  it("rejects a verified refund when its amount exceeds the remaining order balance", async () => {
    const f = fixture({
      verificationStatus: "PENDING",
      reviewStatus: "PENDING",
    });
    f.provider.getRefund = jest.fn().mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      payment_id: "44444444-4444-4444-8444-444444444444",
      status: "succeeded",
      amount: { value: "50.00", currency: "RUB" },
      created_at: "2026-10-15T10:00:00.000Z",
    });
    f.provider.getPayment = jest.fn().mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      status: "succeeded",
      paid: true,
      test: true,
      recipient: { account_id: "shop-1" },
      amount: { value: "99.00", currency: "RUB" },
      metadata: {
        paymentId: "55555555-5555-4555-8555-555555555555",
        productCode: "AEROCRM",
        plan: "AEROCRM",
        billingPeriod: "MONTHLY",
        kind: "ONE_TIME",
      },
    });
    f.tx.crmRefundReview.aggregate.mockResolvedValue({
      _sum: { amountMinor: 6000n },
    });
    await expect(f.service.processOne()).resolves.toBe(true);
    expect(f.tx.$executeRaw).toHaveBeenCalled();
    expect(f.tx.crmRefundReview.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        orderId: "55555555-5555-4555-8555-555555555555",
        verificationStatus: "VERIFIED",
      }),
      _sum: { amountMinor: true },
    });
    expect(f.prisma.crmRefundReview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: "REJECTED",
          lastErrorCode: "REFUND_TOTAL_EXCEEDS_PAYMENT",
        }),
      }),
    );
  });
});
