import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/crm-customers-client";
import { createHash } from "node:crypto";
import { CrmCustomersPrismaService } from "../prisma/crm-customers-prisma.service";
import {
  MailAuthorizationClient,
  assertMailPermission,
  type MailAuthority,
} from "./mail-authorization.client";
import type { SaveMailTemplatesDto } from "./mail-templates.dto";

export interface MailTemplate {
  id: string;
  title: string;
  subject: string;
  body: string;
  archived: boolean;
}
export interface MailTemplatesSnapshot {
  schemaVersion: 1;
  workspaceId: string;
  version: number;
  templates: MailTemplate[];
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown, limit: number, multiline: boolean) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  value.trim().length > 0 &&
  !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(
    value,
  );

function validateTemplates(value: unknown): asserts value is MailTemplate[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).sort().join(",") !==
          "archived,body,id,subject,title" ||
        !uuid.test(item.id) ||
        !text(item.title, 200, false) ||
        !text(item.subject, 300, false) ||
        !text(item.body, 4000, true) ||
        typeof item.archived !== "boolean",
    ) ||
    new Set(value.map((item) => item.id.toLowerCase())).size !== value.length
  )
    throw new BadRequestException({ code: "crm_mail_templates_invalid" });
}

function permission(authority: MailAuthority, write: boolean): void {
  assertMailPermission(authority, write ? "mail:manage" : "mail:read");
  if (write && !["OWNER", "CRM_ADMIN"].includes(authority.customer.role))
    throw new ForbiddenException({
      code: "crm_mail_templates_permission_denied",
    });
}

function conflict(): never {
  throw new ConflictException({
    code: "crm_mail_templates_conflict",
    message: "Шаблоны писем изменились. Обновите данные",
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

async function read(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<MailTemplatesSnapshot> {
  const row = await tx.mailTemplateSettings.findUnique({
    where: { workspaceId },
  });
  if (!row) return { schemaVersion: 1, workspaceId, version: 0, templates: [] };
  try {
    if (!Number.isInteger(row.version) || row.version < 1) throw new Error();
    validateTemplates(row.templates);
    return {
      schemaVersion: 1,
      workspaceId,
      version: row.version,
      templates: row.templates,
    };
  } catch {
    throw new ServiceUnavailableException({
      code: "crm_mail_templates_unavailable",
    });
  }
}

function receipt(
  value: unknown,
  workspaceId: string,
  expectedVersion: number,
): MailTemplatesSnapshot {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const result = value as Record<string, unknown>;
    if (
      Object.keys(result).sort().join(",") !==
        "schemaVersion,templates,version,workspaceId" ||
      result.schemaVersion !== 1 ||
      result.workspaceId !== workspaceId ||
      result.version !== expectedVersion + 1
    )
      throw new Error();
    validateTemplates(result.templates);
    return result as unknown as MailTemplatesSnapshot;
  } catch {
    throw new ServiceUnavailableException({
      code: "crm_mail_template_receipt_unavailable",
    });
  }
}

@Injectable()
export class MailTemplatesService {
  constructor(
    private readonly prisma: CrmCustomersPrismaService,
    private readonly authorization: MailAuthorizationClient,
  ) {}

  async settings(authority: MailAuthority, workspaceId: string) {
    permission(authority, false);
    if (authority.customer.workspaceId !== workspaceId)
      throw new ForbiddenException();
    return this.prisma.$transaction((tx) => read(tx, workspaceId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  async save(initial: MailAuthority, dto: SaveMailTemplatesDto, token: string) {
    permission(initial, true);
    if (initial.customer.workspaceId !== dto.workspaceId)
      throw new ForbiddenException();
    validateTemplates(dto.templates);
    const templates = dto.templates.map((item) => ({
      id: item.id.toLowerCase(),
      title: item.title.trim(),
      subject: item.subject.trim(),
      body: item.body.replace(/\r\n?/g, "\n").trim(),
      archived: item.archived,
    }));
    const requestHash = createHash("sha256")
      .update(
        canonical({
          dto,
          subject: initial.customer.subject,
          membershipId: initial.membershipId,
        }),
      )
      .digest("hex");
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = await this.authorization.authorize(token, dto.workspaceId);
      permission(fresh, true);
      if (
        fresh.customer.subject !== initial.customer.subject ||
        fresh.membershipId !== initial.membershipId ||
        fresh.customer.workspaceId !== initial.customer.workspaceId
      )
        throw new ForbiddenException({ code: "crm_mail_authority_changed" });
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-mail-template-command:${dto.commandId}`}, 0))`,
            );
            await tx.$executeRaw(
              Prisma.sql`SELECT crm_customers.assert_workspace_open(${dto.workspaceId}::uuid)`,
            );
            const prior = await tx.mailTemplateCommand.findUnique({
              where: { commandId: dto.commandId },
            });
            if (prior) {
              if (
                prior.workspaceId !== fresh.customer.workspaceId ||
                prior.actorSubject !== fresh.customer.subject ||
                prior.actorMembershipId !== fresh.membershipId ||
                prior.requestHash !== requestHash
              )
                throw new ConflictException({
                  code: "crm_mail_template_command_conflict",
                });
              return receipt(
                prior.result,
                dto.workspaceId,
                dto.expectedVersion,
              );
            }
            const previous = await read(tx, dto.workspaceId);
            if (previous.version !== dto.expectedVersion) conflict();
            for (const item of previous.templates)
              if (!templates.some((next) => next.id === item.id.toLowerCase()))
                conflict();
            if (previous.version === 0)
              await tx.mailTemplateSettings.create({
                data: { workspaceId: dto.workspaceId, version: 1, templates },
              });
            else {
              const updated = await tx.mailTemplateSettings.updateMany({
                where: {
                  workspaceId: dto.workspaceId,
                  version: dto.expectedVersion,
                },
                data: { version: { increment: 1 }, templates },
              });
              if (updated.count !== 1) conflict();
            }
            const result = await read(tx, dto.workspaceId);
            await tx.mailTemplateCommand.create({
              data: {
                commandId: dto.commandId,
                workspaceId: dto.workspaceId,
                actorSubject: fresh.customer.subject,
                actorMembershipId: fresh.membershipId,
                requestHash,
                result: result as unknown as Prisma.InputJsonValue,
              },
            });
            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 15000,
            maxWait: 5000,
          },
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "P2002"
        )
          conflict();
        if (
          attempt === 2 ||
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "P2034"
        )
          throw error;
      }
    }
    conflict();
  }
}
