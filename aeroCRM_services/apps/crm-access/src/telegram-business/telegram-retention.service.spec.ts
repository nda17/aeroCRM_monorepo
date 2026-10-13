import { TelegramRetentionService } from "./telegram-retention.service";
import { parseCrmAccessRetentionFlag } from "../runtime/crm-access-runtime.service";

const counts = {
  inboxPurged: 7,
  sessionsPurged: 3,
  deliveriesSettled: 2,
};

function setup(
  options: {
    enabled?: boolean;
    telegramWorkerEnabled?: boolean;
    query?: jest.Mock;
  } = {},
) {
  const query =
    options.query || jest.fn().mockResolvedValue([{ result: counts }]);
  const prisma = { $queryRaw: query };
  const runtime = {
    retentionEnabled: options.enabled ?? true,
    telegramWorkerEnabled: options.telegramWorkerEnabled ?? true,
  };
  const service = new TelegramRetentionService(
    prisma as never,
    runtime as never,
  );
  return { service, query };
}

describe("CRM Access Telegram retention", () => {
  it("parses the opt-in flag strictly and defaults absent configuration off", () => {
    expect(parseCrmAccessRetentionFlag(undefined)).toBe(false);
    expect(parseCrmAccessRetentionFlag("")).toBe(false);
    expect(parseCrmAccessRetentionFlag("false")).toBe(false);
    expect(parseCrmAccessRetentionFlag("true")).toBe(true);
    expect(() => parseCrmAccessRetentionFlag("yes")).toThrow(
      "CRM_ACCESS_RETENTION_ENABLED must be true or false",
    );
  });

  it.each([
    ["feature disabled", { enabled: false, telegramWorkerEnabled: true }],
    ["wrong process role", { enabled: true, telegramWorkerEnabled: false }],
  ])("does not query the database when %s", async (_label, options) => {
    const { service, query } = setup(options);
    await service.tick();
    expect(query).not.toHaveBeenCalled();
    expect(service.progress()).toMatchObject({
      enabled: false,
      running: false,
      passes: 0,
      lastResult: null,
    });
  });

  it("records one bounded retirement pass and exposes only aggregate counts", async () => {
    const { service, query } = setup();
    await service.tick();
    const progress = service.progress();

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain(
      "retire_telegram_technical_data",
    );
    expect(progress).toMatchObject({
      enabled: true,
      running: false,
      lastErrorCode: null,
      consecutiveFailures: 0,
      passes: 1,
      lastResult: counts,
    });
    expect(progress.lastAttemptAt).toEqual(expect.any(String));
    expect(progress.lastSuccessAt).toEqual(expect.any(String));
    expect(JSON.stringify(progress)).not.toContain("payload");
  });

  it("fails closed on invalid result counts and logs only the stable error code", async () => {
    const { service } = setup({
      query: jest.fn().mockResolvedValue([
        {
          result: {
            inboxPurged: 101,
            sessionsPurged: 0,
            deliveriesSettled: 0,
            payload: "sensitive payload",
          },
        },
      ]),
    });
    const loggerWarn = jest
      .spyOn(
        (
          service as unknown as {
            logger: { warn: (...args: unknown[]) => void };
          }
        ).logger,
        "warn",
      )
      .mockImplementation(() => undefined);
    await service.tick();
    expect(service.progress()).toMatchObject({
      lastErrorCode: "CRM_TELEGRAM_RETENTION_FAILED",
      consecutiveFailures: 1,
      passes: 0,
      lastResult: null,
    });
    expect(loggerWarn).toHaveBeenCalledWith("CRM_TELEGRAM_RETENTION_FAILED");
    expect(loggerWarn.mock.calls.flat().join(" ")).not.toContain(
      "sensitive payload",
    );
    loggerWarn.mockRestore();
  });

  it("prevents overlapping passes and stops future passes after shutdown", async () => {
    let resolveQuery!: (value: unknown) => void;
    const query = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const { service } = setup({ query });
    const first = service.tick();
    expect(service.progress().running).toBe(true);
    await service.tick();
    expect(query).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    resolveQuery([{ result: counts }]);
    await first;
    await service.tick();
    expect(query).toHaveBeenCalledTimes(1);
    expect(service.progress()).toMatchObject({
      running: false,
      passes: 1,
      lastResult: counts,
    });
  });
});
