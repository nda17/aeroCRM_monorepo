import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  parseCustomersAuthorization,
  parseCustomersAccessOrigin,
  CustomersAuthorization,
} from "../access/customers-authorization.client";
export class MailAuthorityRevokedException extends ForbiddenException {
  constructor(readonly reason: string) {
    super({ code: "crm_mail_authority_revoked", reason });
  }
}
export interface MailAuthority {
  schemaVersion: 1;
  customer: CustomersAuthorization;
  membershipId: string;
  mailPermissions: string[];
}
export function parseMailAuthority(
  value: unknown,
  workspaceId: string,
): MailAuthority | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !==
      "customer,mailPermissions,membershipId,schemaVersion" ||
    v.schemaVersion !== 1 ||
    typeof v.membershipId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v.membershipId,
    ) ||
    !Array.isArray(v.mailPermissions) ||
    v.mailPermissions.length > 3 ||
    new Set(v.mailPermissions).size !== v.mailPermissions.length ||
    !v.mailPermissions.every((x) =>
      ["mail:read", "mail:send", "mail:manage"].includes(x),
    )
  )
    return null;
  const customer = parseCustomersAuthorization(v.customer, workspaceId);
  return customer
    ? {
        schemaVersion: 1,
        customer,
        membershipId: v.membershipId,
        mailPermissions: v.mailPermissions,
      }
    : null;
}
@Injectable()
export class MailAuthorizationClient {
  private readonly origin = parseCustomersAccessOrigin(
    process.env.CRM_ACCESS_INTERNAL_BASE_URL,
  );
  private readonly token: string;
  constructor() {
    this.token = process.env.CRM_ACCESS_CRM_CUSTOMERS_TOKEN?.trim() || "";
    if (
      this.token.length < 32 ||
      /change[_-]?me|<[^>]+>|^ci_/i.test(this.token) ||
      /\s/.test(this.token)
    ) {
      throw new Error(
        "CRM_ACCESS_CRM_CUSTOMERS_TOKEN requires a non-placeholder secret of at least 32 characters",
      );
    }
  }
  authorize(token: string | undefined, workspaceId: string) {
    if (!token || !/^Bearer [^\s]{1,8192}$/.test(token))
      throw new UnauthorizedException();
    return this.request(
      "authorize-mail",
      { schemaVersion: 1, workspaceId },
      token,
    );
  }
  workflow(
    workspaceId: string,
    subject: string,
    membershipId: string,
    purpose: "MAIL_SYNC" | "MAIL_SEND",
  ) {
    return this.request("authorize-mail-workflow", {
      schemaVersion: 1,
      workspaceId,
      subject,
      membershipId,
      purpose,
    });
  }
  private async request(
    path: string,
    body: { workspaceId: string; [key: string]: unknown },
    token?: string,
  ): Promise<MailAuthority> {
    try {
      const response = await fetch(
        `${this.origin}/internal/v1/crm-access/${path}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            "content-type": "application/json",
            "x-aerocrm-service": "crm-customers",
            "x-aerocrm-internal-token": this.token,
            ...(token ? { authorization: token } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      if (response.status === 401 && path !== "authorize-mail-workflow") {
        await response.body?.cancel();
        throw new UnauthorizedException();
      }
      if (response.status === 403) {
        if (
          path === "authorize-mail-workflow" &&
          body.purpose === "MAIL_SYNC"
        ) {
          if (!response.body) throw new Error("MAIL_AUTHORITY_UNAVAILABLE");
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.byteLength;
              if (size > 4096) {
                await reader.cancel();
                throw new Error("MAIL_AUTHORITY_TOO_LARGE");
              }
              chunks.push(part.value);
            }
          } finally {
            reader.releaseLock();
          }
          {
            const denied = JSON.parse(
              Buffer.concat(chunks, size).toString("utf8"),
            ) as Record<string, unknown>;
            if (
              denied &&
              Object.keys(denied).sort().join(",") ===
                "code,membershipId,reason,schemaVersion,subject,workspaceId" &&
              denied.schemaVersion === 1 &&
              denied.code === "crm_mail_authority_revoked" &&
              denied.workspaceId === body.workspaceId &&
              denied.subject === body.subject &&
              denied.membershipId === body.membershipId &&
              typeof denied.reason === "string" &&
              [
                "MEMBERSHIP_REVOKED",
                "ROLE_REVOKED",
                "MAIL_READ_REVOKED",
              ].includes(String(denied.reason))
            )
              throw new MailAuthorityRevokedException(String(denied.reason));
          }
          throw new Error("MAIL_AUTHORITY_UNAVAILABLE");
        }
        await response.body?.cancel();
        throw new ForbiddenException();
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error("MAIL_AUTHORITY_UNAVAILABLE");
      }
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 65536) {
            await reader.cancel();
            throw new Error("MAIL_AUTHORITY_TOO_LARGE");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const result = parseMailAuthority(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
        body.workspaceId,
      );
      if (
        !result ||
        (path === "authorize-mail-workflow" &&
          (result.customer.subject !== body.subject ||
            result.membershipId !== body.membershipId))
      )
        throw new Error("MAIL_AUTHORITY_CONTRACT");
      return result;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      )
        throw error;
      throw new ServiceUnavailableException({
        code: "crm_mail_access_unavailable",
      });
    }
  }
}
export function assertMailPermission(
  authority: MailAuthority,
  permission: string,
): void {
  if (
    !authority.mailPermissions.includes(permission) ||
    (permission !== "mail:read" && authority.customer.state === "READ_ONLY")
  )
    throw new ForbiddenException({ code: "crm_mail_permission_denied" });
}
