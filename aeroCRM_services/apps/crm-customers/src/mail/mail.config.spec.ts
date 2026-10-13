import {
  canonicalMailJson,
  digest,
  flag,
  mailRole,
  MailConfig,
} from "./mail.config";

const legacyId = "legacy-1";
const credentialId = "credential-2";
const hmacId = "hmac-2";
const legacyKey = Buffer.alloc(32, 7);
const credentialKey = Buffer.alloc(32, 8);
const hmacKey = Buffer.alloc(32, 9);
const credentialKeyringName = "CRM_MAIL_CREDENTIAL_KEYRING";
const credentialActiveName = "CRM_MAIL_CREDENTIAL_ACTIVE_KEY_ID";
const hmacKeyringName = "CRM_MAIL_HMAC_KEYRING";
const hmacActiveName = "CRM_MAIL_HMAC_ACTIVE_KEY_ID";

function configureLegacy() {
  process.env.CRM_MAIL_ENABLED = "true";
  process.env.CRM_MAIL_CREDENTIAL_KEY = legacyKey.toString("base64");
  process.env.CRM_MAIL_CREDENTIAL_KEY_ID = legacyId;
}

function configureRotation() {
  configureLegacy();
  process.env[credentialKeyringName] = JSON.stringify({
    [legacyId]: legacyKey.toString("base64"),
    [credentialId]: credentialKey.toString("base64"),
  });
  process.env[credentialActiveName] = credentialId;
  process.env[hmacKeyringName] = JSON.stringify({
    [legacyId]: legacyKey.toString("base64"),
    [hmacId]: hmacKey.toString("base64"),
  });
  process.env[hmacActiveName] = hmacId;
}

describe("mail configuration and credential protection", () => {
  const original = { ...process.env };
  const mailEnvNames = [
    "CRM_MAIL_ENABLED",
    "CRM_MAIL_SYNC_ENABLED",
    "CRM_MAIL_SEND_ENABLED",
    "CRM_MAIL_CREDENTIAL_KEY",
    "CRM_MAIL_CREDENTIAL_KEY_ID",
    credentialKeyringName,
    credentialActiveName,
    hmacKeyringName,
    hmacActiveName,
    "CRM_MAIL_KEY_ROTATION_ENABLED",
    "CRM_CUSTOMERS_PROCESS_ROLE",
  ];

  beforeEach(() => {
    for (const name of mailEnvNames) delete process.env[name];
  });
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
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = legacyId;
    expect(() => new MailConfig()).toThrow(/key configuration invalid/);
    process.env.CRM_MAIL_CREDENTIAL_KEY = legacyKey.toString("base64");
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "bad key id";
    expect(() => new MailConfig()).toThrow(/key configuration invalid/);
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = legacyId;
    expect(new MailConfig().key).toHaveLength(32);
  });

  it("keeps legacy AES ciphertext readable and keeps legacy encryption wire-compatible", () => {
    configureLegacy();
    const config = new MailConfig();
    const aad = config.aad(
      "workspace",
      "connection",
      "user",
      1,
      "transport-hash",
    );
    const legacyCiphertext =
      "legacy-1.AQEBAQEBAQEBAQEB.uqxeAD+ekgtMmCs6Wz9iVQ==.DcP51uPMm2GjsP4bUkQVUtqeYNZl";
    expect(config.decrypt(legacyCiphertext, aad)).toEqual({
      password: "secret",
    });
    expect(config.keyId).toBe(legacyId);
    expect(config.encrypt({ password: "secret" }, aad).split(".")[0]).toBe(
      legacyId,
    );
  });

  it("encrypts with the active credential key and can decrypt retained previous keys after rotation", () => {
    configureLegacy();
    const beforeRotation = new MailConfig();
    const aad = beforeRotation.aad(
      "workspace",
      "connection",
      "user",
      1,
      "transport-hash",
    );
    const oldCiphertext = beforeRotation.encrypt({ password: "secret" }, aad);
    configureRotation();
    const config = new MailConfig();
    const newCiphertext = config.encrypt({ password: "rotated" }, aad);

    expect(newCiphertext.split(".")[0]).toBe(credentialId);
    expect(config.decrypt(newCiphertext, aad)).toEqual({ password: "rotated" });
    expect(config.decrypt(oldCiphertext, aad)).toEqual({ password: "secret" });
  });

  it.each([
    ["credential keyring without active id", credentialKeyringName],
    ["credential active id without keyring", credentialActiveName],
    ["HMAC keyring without active id", hmacKeyringName],
    ["HMAC active id without keyring", hmacActiveName],
  ])("rejects a partial %s configuration", (_label, variable) => {
    configureLegacy();
    process.env[variable] = variable.endsWith("KEYRING")
      ? JSON.stringify({ [legacyId]: legacyKey.toString("base64") })
      : legacyId;
    expect(() => new MailConfig()).toThrow(/keyring configuration invalid/i);
  });

  it.each([
    [
      "invalid key id",
      { "bad id": Buffer.alloc(32, 8).toString("base64") },
      "key-2",
    ],
    ["invalid base64 key", { "key-2": "not-a-key" }, "key-2"],
    [
      "missing active key",
      { "key-3": Buffer.alloc(32, 8).toString("base64") },
      "key-2",
    ],
    [
      "changed retained legacy key",
      { [legacyId]: Buffer.alloc(32, 6).toString("base64") },
      legacyId,
    ],
  ])("fails closed for a keyring with %s", (_label, keyring, active) => {
    configureLegacy();
    process.env[credentialKeyringName] = JSON.stringify(keyring);
    process.env[credentialActiveName] = active;
    expect(() => new MailConfig()).toThrow(/keyring configuration invalid/i);
  });

  it("binds encrypted credentials to workspace, connection, principal, generation and transport", () => {
    configureLegacy();
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
    process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "legacy-2";
    expect(() => new MailConfig().decrypt(encrypted, aad)).toThrow(
      "MAIL_CREDENTIAL_KEY_UNAVAILABLE",
    );
  });

  it("uses only configured HMAC keys and retains old HMAC candidates for command receipts", () => {
    configureRotation();
    const config = new MailConfig();
    const request = { operation: "SEND", commandId: "command-1" };
    const hashes = config.requestHash(request);

    expect(config.hmacKeyId).toBe(hmacId);
    expect(hashes.keyId).toBe(hmacId);
    expect(hashes.value).toBe(config.keyedDigest(request, hmacId));
    expect(hashes.candidates.get(null)).toBe(config.keyedDigest(request, null));
    expect(hashes.candidates.get(hmacId)).toBe(hashes.value);
    expect(() => config.keyedDigest(request, "unknown-key")).toThrow(
      "MAIL_HMAC_KEY_UNAVAILABLE",
    );
  });

  it("supports legacy command hashes and cursors with byte-compatible formats", () => {
    configureLegacy();
    const config = new MailConfig();
    const request = { commandId: "command-1", body: { value: 3 } };
    const requestHash = config.requestHash(request);
    const cursor = config.signCursor("payload");

    expect(config.hmacKeyId).toBeNull();
    expect(requestHash.keyId).toBeNull();
    expect(requestHash.candidates.get(null)).toBe(requestHash.value);
    expect(cursor).toBe(`payload.${config.keyedDigest("payload", null)}`);
    expect(config.openCursor(cursor)).toBe("payload");
  });

  it("signs new cursors with the key id and rejects tampered or unknown-key cursors", () => {
    configureRotation();
    const config = new MailConfig();
    const cursor = config.signCursor("payload");

    expect(cursor.split(".")).toHaveLength(4);
    expect(cursor.startsWith(`v1.${hmacId}.`)).toBe(true);
    expect(config.openCursor(cursor)).toBe("payload");
    expect(() => config.openCursor(`${cursor.slice(0, -1)}x`)).toThrow(
      "MAIL_CURSOR_INVALID",
    );
    expect(() =>
      config.openCursor(cursor.replace(`v1.${hmacId}.`, "v1.unknown-key.")),
    ).toThrow("MAIL_HMAC_KEY_UNAVAILABLE");
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
