import {
  canonicalMailJson,
  digest,
  flag,
  mailRole,
  MailConfig,
} from "./mail.config";

describe("mail configuration and credential protection", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("accepts only explicit boolean feature flags and known process roles", () => {
    delete process.env.CRM_MAIL_ENABLED;
    expect(flag("CRM_MAIL_ENABLED")).toBe(false);
    process.env.CRM_MAIL_ENABLED = "true";
    expect(flag("CRM_MAIL_ENABLED")).toBe(true);
    process.env.CRM_MAIL_ENABLED = "yes";
    expect(() => flag("CRM_MAIL_ENABLED")).toThrow(/must be true or false/);
    process.env.CRM_CUSTOMERS_PROCESS_ROLE = "mail-sync";
    expect(mailRole()).toBe("mail-sync");
    process.env.CRM_CUSTOMERS_PROCESS_ROLE = "shell";
    expect(() => mailRole()).toThrow(/PROCESS_ROLE is invalid/);
  });

  it("requires a 256-bit key and key id when mail is enabled", () => {
    process.env.CRM_MAIL_ENABLED = "true";
    process.env.CRM_MAIL_CREDENTIAL_KEY = Buffer.alloc(31).toString("base64");
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "key-1";
    expect(() => new MailConfig()).toThrow(/key configuration invalid/);
    process.env.CRM_MAIL_CREDENTIAL_KEY = Buffer.alloc(32).toString("base64");
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "bad key id";
    expect(() => new MailConfig()).toThrow(/key configuration invalid/);
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "key-1";
    expect(new MailConfig().key).toHaveLength(32);
  });

  it("binds encrypted credentials to workspace, connection, principal, generation and transport", () => {
    process.env.CRM_MAIL_ENABLED = "true";
    process.env.CRM_MAIL_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString(
      "base64",
    );
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "key-1";
    const config = new MailConfig();
    const aad = config.aad(
      "workspace",
      "connection",
      "user",
      1,
      "transport-hash",
    );
    const encrypted = config.encrypt({ password: "secret" }, aad);
    expect(config.decrypt(encrypted, aad)).toEqual({ password: "secret" });
    expect(() => config.decrypt(encrypted, `${aad}!`)).toThrow();
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "key-2";
    expect(() => new MailConfig().decrypt(encrypted, aad)).toThrow(
      "MAIL_CREDENTIAL_KEY_UNAVAILABLE",
    );
  });

  it("canonicalizes object key order before hashing while retaining value distinctions", () => {
    expect(canonicalMailJson({ z: 1, a: { y: 2, x: 3 } })).toBe(
      canonicalMailJson({ a: { x: 3, y: 2 }, z: 1 }),
    );
    expect(digest(canonicalMailJson({ a: 1 }))).not.toBe(
      digest(canonicalMailJson({ a: "1" })),
    );
  });
});
