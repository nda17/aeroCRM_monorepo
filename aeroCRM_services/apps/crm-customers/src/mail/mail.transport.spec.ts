import { BadRequestException } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import {
  endpoint,
  MailTransport,
  publicMailAddress,
  resolveMailEndpoint,
} from "./mail.transport";

import { simpleParser } from "mailparser";
import { prepareMailBody } from "./mail.body";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));

describe("mail transport network boundary", () => {
  const imap = {
    host: "imap.example.org",
    port: 993,
    security: "TLS" as const,
    username: "user@example.org",
  };

  it("accepts supported encrypted port and security combinations only", () => {
    expect(endpoint(imap, "imap")).toEqual(imap);
    expect(
      endpoint({ ...imap, port: 143, security: "STARTTLS" }, "imap").port,
    ).toBe(143);
    expect(() => endpoint({ ...imap, port: 25 }, "imap")).toThrow(
      BadRequestException,
    );
    expect(
      endpoint({ ...imap, port: 587, security: "STARTTLS" }, "smtp").port,
    ).toBe(587);
    expect(() => endpoint({ ...imap, port: 587 }, "smtp")).toThrow(
      BadRequestException,
    );
  });

  it.each([
    "127.0.0.1",
    "localhost",
    "mail.internal",
    "mail.example",
    "bad host.example.org",
    "-invalid.example.org",
  ])("rejects non-public or malformed host %s before connecting", (host) => {
    expect(() => endpoint({ ...imap, host }, "imap")).toThrow(
      BadRequestException,
    );
  });

  it("rejects control characters and empty usernames", () => {
    expect(() => endpoint({ ...imap, username: "x\r\ny" }, "imap")).toThrow(
      BadRequestException,
    );
    expect(() => endpoint({ ...imap, username: "" }, "imap")).toThrow(
      BadRequestException,
    );
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.1.1",
    "127.0.0.1",
    "169.254.1.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "203.0.113.10",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:8.8.8.8",
  ])(
    "does not classify reserved address %s as a public mail server",
    (address) => {
      expect(publicMailAddress(address)).toBe(false);
    },
  );

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts public unicast address %s",
    (address) => expect(publicMailAddress(address)).toBe(true),
  );

  it("pins a resolved public address but rejects mixed/private DNS answers and oversized answer sets", async () => {
    const lookupMock = jest.mocked(lookup);
    lookupMock.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ] as never);
    expect(await resolveMailEndpoint("imap.example.org")).toBe("8.8.8.8");
    lookupMock.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    await expect(resolveMailEndpoint("imap.example.org")).rejects.toThrow(
      "MAIL_HOST_NOT_PUBLIC",
    );
    lookupMock.mockResolvedValueOnce(
      Array.from({ length: 17 }, (_, index) => ({
        address: `8.8.8.${index + 1}`,
        family: 4,
      })) as never,
    );
    await expect(resolveMailEndpoint("imap.example.org")).rejects.toThrow(
      "MAIL_HOST_NOT_PUBLIC",
    );
  });
});


describe("mail MIME alternatives", () => {
  it("builds safe HTML, derived plain text and attachment without connecting", async () => {
    const transport = new MailTransport({} as never);
    const body = prepareMailBody({ text: "untrusted client fallback", html: '<p><strong>Привет</strong> <a href="https://example.org">документ</a><img src="https://tracker.example/x"></p>' });
    const bytes = await transport.mime({ canonicalAddress: "team@example.org", displayName: "Sales" } as never, {
      to: [{ address: "customer@example.org" }], cc: [], bcc: [{ address: "private@example.org" }],
      subject: "Rich mail", text: body.text, html: body.html!, messageId: "<rich@example.org>",
      attachments: [{ filename: "offer.txt", content: Buffer.from("offer"), contentType: "text/plain" }],
    });
    const parsed = await simpleParser(bytes);
    expect(parsed.text).toContain("Привет");
    expect(parsed.text).toContain("https://example.org");
    expect(parsed.text).not.toContain("untrusted client fallback");
    expect(parsed.html).toBe(body.html);
    expect(parsed.html).not.toContain("tracker");
    expect(parsed.bcc).toBeUndefined();
    expect(parsed.attachments[0].content.toString()).toBe("offer");
    expect(bytes.toString()).toContain("multipart/alternative");
  });
});
