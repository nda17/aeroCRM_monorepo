import "reflect-metadata";
import { ForbiddenException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { ConfigService } from "@nestjs/config";
import { CrmAuthorizationController } from "./crm-authorization.controller";
import { CrmAuthorizationService } from "./crm-authorization.service";
import { CrmInternalGuard } from "./crm-internal.guard";
import { CrmAccessHttpExceptionFilter } from "../common/crm-access-http-exception.filter";
import { configureCrmAccessApiPrefix } from "../common/crm-access-api.config";
import { CrmAssigneeAuthorizationController } from "../team/team-assignee.controller";
import { CrmAssigneeService } from "../team/team-assignee.service";
import {
  ChatAttachmentsController,
  ChatUploadScopeGuard,
} from "../workspace-chat/chat-attachments.controller";
import { ChatAttachmentsService } from "../workspace-chat/chat-attachments.service";

describe("mail workflow HTTP contract", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const membershipId = "22222222-2222-4222-8222-222222222222";
  const subject = "member@example.test";
  const token = "test-crm-customers-token-with-at-least-32-characters";
  const salesToken =
    "test-crm-sales-internal-token-with-at-least-32-characters";
  const intakeToken =
    "test-crm-intake-internal-token-with-at-least-32-characters";
  let app: INestApplication;
  let origin: string;
  let authorization: { authorizeMailWorkflow: jest.Mock };
  let denial: Record<string, unknown>;
  let assignees: {
    resolve: jest.Mock;
    authorizeIntake: jest.Mock;
    taskReaders: jest.Mock;
  };
  let chatAttachments: { preflight: jest.Mock; upload: jest.Mock };

  beforeAll(async () => {
    authorization = {
      authorizeMailWorkflow: jest.fn(async () => {
        throw new ForbiddenException(denial);
      }),
    };
    denial = {
      schemaVersion: 1,
      code: "crm_mail_authority_revoked",
      workspaceId,
      subject,
      membershipId,
      reason: "MAIL_READ_REVOKED",
    };
    assignees = {
      resolve: jest.fn(async () => ({
        schemaVersion: 1,
        workspaceId,
        binding: null,
      })),
      authorizeIntake: jest.fn(async () => ({
        schemaVersion: 1,
        workspaceId,
        allowed: true,
      })),
      taskReaders: jest.fn(async () => ({
        schemaVersion: 1,
        workspaceId,
        items: [],
      })),
    };
    chatAttachments = {
      preflight: jest.fn(async () => undefined),
      upload: jest.fn(async (_token, _id, _dto, file) => ({
        filename: file.originalname,
      })),
    };
    const module = await Test.createTestingModule({
      controllers: [
        CrmAuthorizationController,
        CrmAssigneeAuthorizationController,
        ChatAttachmentsController,
      ],
      providers: [
        CrmInternalGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                CRM_ACCESS_CRM_CUSTOMERS_TOKEN: token,
                CRM_ACCESS_CRM_SALES_TOKEN: salesToken,
                CRM_ACCESS_CRM_INTAKE_TOKEN: intakeToken,
              })[key],
          },
        },
        { provide: CrmAuthorizationService, useValue: authorization },
        { provide: CrmAssigneeService, useValue: assignees },
        { provide: ChatAttachmentsService, useValue: chatAttachments },
        ChatUploadScopeGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    configureCrmAccessApiPrefix(app);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new CrmAccessHttpExceptionFilter());
    await app.listen(0, "127.0.0.1");
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => app?.close());

  const salesHeaders = {
    "content-type": "application/json",
    "x-aerocrm-service": "crm-sales",
    "x-aerocrm-internal-token": salesToken,
  };

  const post = (path: string, body = {}) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aerocrm-service": "crm-customers",
        "x-aerocrm-internal-token": token,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        workspaceId,
        subject,
        membershipId,
        purpose: "MAIL_SYNC",
        ...body,
      }),
    });

  it("serves the exact excluded internal route and preserves only the bound typed denial", async () => {
    const response = await post(
      "/internal/v1/crm-access/authorize-mail-workflow",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      code: "crm_mail_authority_revoked",
      workspaceId,
      subject,
      membershipId,
      reason: "MAIL_READ_REVOKED",
    });
    expect(authorization.authorizeMailWorkflow).toHaveBeenCalledTimes(1);
  });

  it("does not expose an /api/v1 alias or classify mismatched and ordinary denials as revocation", async () => {
    const alias = await post(
      "/api/v1/internal/v1/crm-access/authorize-mail-workflow",
    );
    expect(alias.status).toBe(404);

    const mismatchedBinding = await post(
      "/internal/v1/crm-access/authorize-mail-workflow",
      {
        workspaceId: "33333333-3333-4333-8333-333333333333",
      },
    );
    expect(mismatchedBinding.status).toBe(403);
    expect(await mismatchedBinding.json()).toEqual({
      statusCode: 403,
      message: "Request failed",
      error: "ForbiddenException",
      code: "crm_mail_authority_revoked",
    });

    const invalidDto = await post(
      "/internal/v1/crm-access/authorize-mail-workflow",
      { extra: true },
    );
    expect(invalidDto.status).toBe(400);
  });

  it("requires the real internal guard credentials before the controller runs", async () => {
    const response = await fetch(
      `${origin}/internal/v1/crm-access/authorize-mail-workflow`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          workspaceId,
          subject,
          membershipId,
          purpose: "MAIL_SYNC",
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      statusCode: 403,
      code: "http_error",
    });
    expect(authorization.authorizeMailWorkflow).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["resolve-sales-assignee", { schemaVersion: 1, workspaceId, subject }],
    [
      "authorize-sales-intake",
      { schemaVersion: 1, workspaceId, subject, purpose: "INTAKE_ACCEPT" },
    ],
    [
      "resolve-sales-task-readers",
      { schemaVersion: 1, workspaceId, bindings: [{ subject, membershipId }] },
    ],
  ] as const)("keeps the real %s POST outside /api/v1", async (route, body) => {
    const path = `/internal/v1/crm-access/${route}`;
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: salesHeaders,
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const alias = await fetch(`${origin}/api/v1${path}`, {
      method: "POST",
      headers: salesHeaders,
      body: JSON.stringify(body),
    });
    expect(alias.status).toBe(404);
  });

  it("preserves a Cyrillic and emoji upload filename through Multer", async () => {
    const filename = "тестовое вложение 😀.txt";
    const commandId = "44444444-4444-4444-8444-444444444444";
    const conversationId = "55555555-5555-4555-8555-555555555555";
    const form = new FormData();
    form.set("schemaVersion", "1");
    form.set("workspaceId", workspaceId);
    form.set("commandId", commandId);
    form.set("file", new Blob(["hello"], { type: "text/plain" }), filename);
    const response = await fetch(
      `${origin}/api/v1/crm/access/chat/conversations/${conversationId}/attachments`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "idempotency-key": commandId,
          "x-chat-workspace-id": workspaceId,
        },
        body: form,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ filename });
    expect(chatAttachments.upload.mock.calls[0][3].originalname).toBe(filename);
    expect(chatAttachments.preflight).toHaveBeenCalledWith(
      "Bearer test-token",
      workspaceId,
      conversationId,
    );
  });
});
