import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  MailAuthorizationClient,
  MailAuthorityRevokedException,
} from "./mail-authorization.client";

describe("MailAuthorizationClient HTTP revocation contract", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const membershipId = "22222222-2222-4222-8222-222222222222";
  const subject = "member@example.test";
  const token = "test-customers-token-with-at-least-32-characters";
  let server: Server;
  let client: MailAuthorizationClient;
  let mode: "typed" | "mismatched" | "extra" | "generic" = "typed";
  let previousOrigin: string | undefined;
  let previousToken: string | undefined;

  beforeAll(async () => {
    previousOrigin = process.env.CRM_ACCESS_INTERNAL_BASE_URL;
    previousToken = process.env.CRM_ACCESS_CRM_CUSTOMERS_TOKEN;
    server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      const requestBody = JSON.parse(body);
      response.statusCode = 403;
      response.setHeader("content-type", "application/json");
      if (
        request.url !== "/internal/v1/crm-access/authorize-mail-workflow" ||
        request.headers["x-aerocrm-service"] !== "crm-customers" ||
        request.headers["x-aerocrm-internal-token"] !== token
      ) {
        response.end(JSON.stringify({ statusCode: 403, code: "http_error" }));
        return;
      }
      if (mode === "generic") {
        response.end(JSON.stringify({ statusCode: 403, code: "http_error" }));
        return;
      }
      const denied = {
        schemaVersion: 1,
        code: "crm_mail_authority_revoked",
        workspaceId:
          mode === "mismatched"
            ? "33333333-3333-4333-8333-333333333333"
            : requestBody.workspaceId,
        subject: requestBody.subject,
        membershipId: requestBody.membershipId,
        reason: "MAIL_READ_REVOKED",
      };
      response.end(
        JSON.stringify(
          mode === "extra" ? { ...denied, extra: "unexpected" } : denied,
        ),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    process.env.CRM_ACCESS_INTERNAL_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.CRM_ACCESS_CRM_CUSTOMERS_TOKEN = token;
    client = new MailAuthorizationClient();
  }, 15000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousOrigin === undefined)
      delete process.env.CRM_ACCESS_INTERNAL_BASE_URL;
    else process.env.CRM_ACCESS_INTERNAL_BASE_URL = previousOrigin;
    if (previousToken === undefined)
      delete process.env.CRM_ACCESS_CRM_CUSTOMERS_TOKEN;
    else process.env.CRM_ACCESS_CRM_CUSTOMERS_TOKEN = previousToken;
  }, 15000);

  const authorize = () =>
    client.workflow(workspaceId, subject, membershipId, "MAIL_SYNC");

  it("classifies the exact bound six-key workflow denial as authority revoked", async () => {
    mode = "typed";
    await expect(authorize()).rejects.toBeInstanceOf(
      MailAuthorityRevokedException,
    );
  });

  it.each(["mismatched", "extra", "generic"] as const)(
    "does not classify a %s 403 as mailbox revocation",
    async (nextMode) => {
      mode = nextMode;
      await expect(authorize()).rejects.not.toBeInstanceOf(
        MailAuthorityRevokedException,
      );
    },
  );

  it("does not classify a service-authentication 403 as mailbox revocation", async () => {
    mode = "typed";
    process.env.CRM_ACCESS_CRM_CUSTOMERS_TOKEN =
      "different-valid-customers-token-with-32chars";
    const wrongCredentialClient = new MailAuthorizationClient();
    await expect(
      wrongCredentialClient.workflow(
        workspaceId,
        subject,
        membershipId,
        "MAIL_SYNC",
      ),
    ).rejects.not.toBeInstanceOf(MailAuthorityRevokedException);
    process.env.CRM_ACCESS_CRM_CUSTOMERS_TOKEN = token;
  });
});
