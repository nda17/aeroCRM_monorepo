import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { MailConnectDto, MailSendDto } from "./mail.dto";

const connectInput = () => ({
  schemaVersion: 1,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  commandId: "22222222-2222-4222-8222-222222222222",
  kind: "PERSONAL",
  address: "sales@example.org",
  displayName: "Aero CRM",
  imap: {
    host: "imap.example.org",
    port: 993,
    security: "TLS",
    username: "user@example.org",
  },
  smtp: {
    host: "smtp.example.org",
    port: 587,
    security: "STARTTLS",
    username: "user@example.org",
  },
  password: "application-password",
  smtpPassword: null,
});
const errors = async (type: new () => object, input: object) =>
  validate(plainToInstance(type, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe("strict corporate mail request DTOs", () => {
  it("accepts the universal IMAP/SMTP contract including separate nullable SMTP password", async () => {
    expect(await errors(MailConnectDto, connectInput())).toHaveLength(0);
    expect(
      await errors(MailConnectDto, {
        ...connectInput(),
        smtpPassword: "smtp-specific-secret",
      }),
    ).toHaveLength(0);
  });

  it.each([
    { host: "127.0.0.1" },
    { host: "mail.internal" },
    { port: 25 },
    { port: 143, security: "TLS" },
    { security: "PLAIN" },
    { username: "smtp\r\nBcc: attacker@example.org" },
  ])(
    "rejects unsafe or invalid nested transport settings: %o",
    async (transportPatch) => {
      const input = connectInput();
      input.imap = { ...input.imap, ...transportPatch };
      expect(await errors(MailConnectDto, input)).not.toHaveLength(0);
    },
  );

  it("rejects unknown fields, unsupported providers, and credential control characters", async () => {
    expect(
      await errors(MailConnectDto, {
        ...connectInput(),
        provider: "YANDEX",
      }),
    ).not.toHaveLength(0);
    expect(
      await errors(MailConnectDto, {
        ...connectInput(),
        password: "secret\r\nBcc: x@example.org",
      }),
    ).not.toHaveLength(0);
  });

  it("limits aggregate recipients and measures UTF-8 body bytes rather than characters", async () => {
    const valid = {
      schemaVersion: 1,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      commandId: "22222222-2222-4222-8222-222222222222",
      mailboxId: "33333333-3333-4333-8333-333333333333",
      contactId: "44444444-4444-4444-8444-444444444444",
      to: [{ email: "person@example.org", name: null }],
      cc: [],
      bcc: [],
      subject: "Hello",
      text: "Привет",
      attachmentIds: [],
      replyToMessageId: null,
    };
    expect(await errors(MailSendDto, valid)).toHaveLength(0);
    expect(
      await errors(MailSendDto, {
        ...valid,
        to: Array.from({ length: 11 }, (_, i) => ({
          email: `person${i}@example.org`,
          name: null,
        })),
        cc: Array.from({ length: 10 }, (_, i) => ({
          email: `cc${i}@example.org`,
          name: null,
        })),
      }),
    ).not.toHaveLength(0);
    expect(
      await errors(MailSendDto, { ...valid, text: "я".repeat(13 * 1024) }),
    ).not.toHaveLength(0);
  });
});
