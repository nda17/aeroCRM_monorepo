import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/crm-customers-client";
import { createHash, randomUUID } from "node:crypto";
import { isEmail, isTimeZone, isURL } from "class-validator";
import {
  assertCustomersPermission,
  CustomersAuthorization,
} from "../access/customers-authorization.client";
import { customerScope } from "../customers/customers.service";
import { CrmCustomersPrismaService } from "../prisma/crm-customers-prisma.service";
import { parseImportFile, Sheet } from "./import-parser";

export type ImportEntity = "companies" | "contacts";
export interface InspectInput {
  schemaVersion: 1;
  workspaceId: string;
  entity: ImportEntity;
  filename: string;
  contentBase64: string;
}
export interface PreviewInput extends InspectInput {
  sourceKey: string;
  sheet: string;
  mapping: Record<string, string>;
  options?: {
    teamId?: string;
    pipelineId?: string;
    stageId?: string;
    stageMapping?: Record<string, string>;
  };
  decisions?: Array<{
    row: number;
    action: "LINK" | "SKIP";
    existingId?: string;
    expectedVersion?: number;
  }>;
}
export interface ApplyInput {
  schemaVersion: 1;
  workspaceId: string;
  previewId: string;
  commandId: string;
}
export interface ResolveInput {
  schemaVersion: 1;
  workspaceId: string;
  sourceKey: string;
  references: Array<{ kind: "contact"; externalId?: string; id?: string }>;
}
type ImportAction = "CREATE" | "LINK" | "SKIP" | "ERROR";
type Candidate = { id: string; name: string; version: number };
type ImportRow = {
  row: number;
  sourceId: string | null;
  action: ImportAction;
  targetId: string | null;
  expectedVersion: number | null;
  values: Record<string, string | null>;
  errors: string[];
  warnings: string[];
  candidates: Candidate[];
  payload: Record<string, string | null>;
  payloadHash: string;
  companyId: string | null;
  companyVersion: number | null;
  teamId: string | null;
  unmapped: Record<string, string>;
};
type ApplyResult = {
  schemaVersion: 1;
  previewId: string;
  commandId: string;
  entity: ImportEntity;
  status: "APPLIED";
  created: number;
  linked: number;
  skipped: number;
  items: Array<{
    row: number;
    sourceId: string | null;
    entityId: string | null;
    action: "CREATE" | "LINK" | "SKIP";
  }>;
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS: Record<ImportEntity, readonly string[]> = {
  companies: [
    "externalId",
    "name",
    "inn",
    "website",
    "legalName",
    "kpp",
    "ogrn",
    "legalAddress",
    "entityType",
    "notes",
  ],
  contacts: [
    "externalId",
    "name",
    "firstName",
    "middleName",
    "lastName",
    "phone",
    "email",
    "companyExternalId",
    "companyId",
    "notes",
    "timeZone",
    "preferredCallStart",
    "preferredCallEnd",
  ],
};
function scope(
  context: CustomersAuthorization,
): Prisma.CompanyWhereInput & Prisma.ContactWhereInput {
  return customerScope(context) as Prisma.CompanyWhereInput &
    Prisma.ContactWhereInput;
}
function fail(message: string): never {
  throw new BadRequestException(message);
}
function conflict(message: string): never {
  throw new ConflictException({ code: "crm_file_import_conflict", message });
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function requiredText(value: unknown, label: string, max: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail(`Invalid ${label}`);
  return value.trim();
}
function id(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) fail(`Invalid ${label}`);
  return value;
}
function ownKeys(value: unknown, allowed: string[], label: string) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    fail(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
const FIELD_LABELS: Record<string, string> = {
  externalId: "Внешний ID",
  name: "Название или имя",
  inn: "ИНН",
  website: "Сайт",
  legalName: "Юридическое название",
  kpp: "КПП",
  ogrn: "ОГРН",
  legalAddress: "Юридический адрес",
  entityType: "Тип компании",
  notes: "Заметки",
  firstName: "Имя",
  middleName: "Отчество",
  lastName: "Фамилия",
  phone: "Телефон",
  email: "Электронная почта",
  companyExternalId: "Внешний ID компании",
  companyId: "ID компании",
  timeZone: "Часовой пояс",
  preferredCallStart: "Начало звонка",
  preferredCallEnd: "Окончание звонка",
};
function clean(
  value: string | undefined,
  max: number,
  label: string,
  errors: string[],
) {
  const multiline = label === "notes" || label === "legalAddress";
  const normalized = (value || "").replace(/\r\n?/g, "\n").trim();
  if (
    normalized.length > max ||
    (multiline ? /[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(
      normalized,
    )
  )
    errors.push(
      `${FIELD_LABELS[label] || "Поле"}: неверное значение или превышена длина ${max}`,
    );
  return normalized || null;
}
function normalizedPhone(value: string | null, errors: string[]) {
  if (!value) return null;
  const phone = value.replace(/[\s()\-]/g, "");
  const result =
    phone.startsWith("8") && phone.length === 11
      ? "+7" + phone.slice(1)
      : phone;
  if (!/^\+[1-9][0-9]{6,14}$/.test(result))
    errors.push("Телефон должен быть в международном формате");
  return result;
}
function payloadHash(payload: Record<string, string | null>) {
  return hash(payload);
}
function publicRow(row: ImportRow) {
  const {
    payload,
    payloadHash,
    companyId,
    companyVersion,
    teamId,
    unmapped,
    ...visible
  } = row;
  void payload;
  void payloadHash;
  void companyId;
  void companyVersion;
  void teamId;
  void unmapped;
  return visible;
}
function summary(rows: ImportRow[]) {
  return {
    create: rows.filter((r) => r.action === "CREATE").length,
    link: rows.filter((r) => r.action === "LINK").length,
    skip: rows.filter((r) => r.action === "SKIP").length,
    error: rows.filter((r) => r.action === "ERROR").length,
  };
}

@Injectable()
export class CustomerImportService {
  constructor(private readonly db: CrmCustomersPrismaService) {}
  private access(
    context: CustomersAuthorization,
    workspaceId: string,
    write: boolean,
  ) {
    if (context.workspaceId !== workspaceId)
      throw new ForbiddenException("Workspace scope mismatch");
    assertCustomersPermission(context, "customers:read");
    if (write) assertCustomersPermission(context, "customers:write", true);
  }
  private basic(input: InspectInput) {
    ownKeys(
      input,
      [
        "schemaVersion",
        "workspaceId",
        "entity",
        "filename",
        "contentBase64",
        "sourceKey",
        "sheet",
        "mapping",
        "options",
        "decisions",
      ],
      "import",
    );
    if (
      input.schemaVersion !== 1 ||
      !["companies", "contacts"].includes(input.entity)
    )
      fail("Invalid import entity");
    id(input.workspaceId, "workspaceId");
    return parseImportFile(input as unknown as Record<string, unknown>, true);
  }
  inspect(context: CustomersAuthorization, input: InspectInput) {
    this.access(context, input.workspaceId, false);
    const file = this.basic(input);
    return {
      schemaVersion: 1,
      entity: input.entity,
      fileDigest: file.digest,
      sheets: file.sheets.map((sheet) => ({
        name: sheet.name,
        headers: sheet.headers,
        rowCount: sheet.rows.length,
        sample: sheet.rows.slice(0, 5),
      })),
    };
  }
  private validateMapping(input: PreviewInput, sheet: Sheet) {
    const mapping = ownKeys(
      input.mapping,
      [...COLUMNS[input.entity]],
      "mapping",
    ) as Record<string, string>;
    if (input.entity === "companies" && !mapping.name) fail("Map company name");
    if (
      input.entity === "contacts" &&
      !mapping.name &&
      !(mapping.firstName || mapping.lastName)
    )
      fail("Map contact name");
    if (
      Object.values(mapping).some(
        (h) => typeof h !== "string" || !sheet.headers.includes(h),
      )
    )
      fail("Mapping has unknown column");
    if (new Set(Object.values(mapping)).size !== Object.values(mapping).length)
      fail("Columns must be mapped once");
    return mapping;
  }
  private normalize(
    entity: ImportEntity,
    raw: Record<string, string>,
    mapping: Record<string, string>,
    sheet: Sheet,
    line: number,
  ) {
    const errors: string[] = [],
      warnings: string[] = [];
    const mapped = (field: string) =>
      mapping[field] ? raw[mapping[field]] : undefined;
    const payload: Record<string, string | null> = {};
    if (entity === "companies") {
      for (const field of COLUMNS.companies)
        payload[field] = clean(
          mapped(field),
          field === "notes"
            ? 5000
            : field === "website"
              ? 2048
              : field === "name"
                ? 200
                : field === "externalId"
                  ? 256
                  : field === "inn"
                    ? 12
                    : field === "kpp"
                      ? 9
                      : field === "ogrn"
                        ? 15
                        : field === "entityType"
                          ? 16
                          : 2000,
          field,
          errors,
        );
      if (!payload.name) errors.push("Укажите название компании");
      if (payload.inn && !/^([0-9]{10}|[0-9]{12})$/.test(payload.inn))
        errors.push("ИНН: ожидаются 10 или 12 цифр");
      if (payload.kpp && !/^[0-9]{9}$/.test(payload.kpp))
        errors.push("КПП: ожидаются 9 цифр");
      if (payload.ogrn && !/^([0-9]{13}|[0-9]{15})$/.test(payload.ogrn))
        errors.push("ОГРН: ожидаются 13 или 15 цифр");
      if (
        payload.website &&
        !isURL(payload.website, {
          protocols: ["http", "https"],
          require_protocol: true,
          require_valid_protocol: true,
          disallow_auth: true,
        })
      )
        errors.push(
          "Сайт: нужен корректный адрес http или https без учётных данных",
        );
      if (
        payload.entityType &&
        !["LEGAL", "INDIVIDUAL"].includes(payload.entityType)
      )
        errors.push("Тип компании: выберите юридическое или физическое лицо");
    } else {
      for (const field of COLUMNS.contacts)
        payload[field] = clean(
          mapped(field),
          field === "notes"
            ? 5000
            : field === "email"
              ? 254
              : field === "name" || field.endsWith("Name")
                ? 200
                : field === "externalId" || field === "companyExternalId"
                  ? 256
                  : field === "companyId"
                    ? 36
                    : field === "timeZone"
                      ? 100
                      : field.startsWith("preferred")
                        ? 5
                        : 40,
          field,
          errors,
        );
      payload.name =
        payload.name ||
        [payload.firstName, payload.middleName, payload.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        null;
      if (!payload.name || payload.name.length > 200)
        errors.push("Укажите имя контакта не длиннее 200 символов");
      payload.phone = normalizedPhone(payload.phone, errors);
      payload.email = payload.email?.toLowerCase() || null;
      if (payload.email && !isEmail(payload.email))
        errors.push("Электронная почта указана неверно");
      if (payload.companyId && !UUID.test(payload.companyId))
        errors.push("Идентификатор компании указан неверно");
      if (payload.companyId && payload.companyExternalId)
        errors.push("Укажите компанию одним способом: ID или внешний ID");
      if (
        payload.timeZone &&
        (!/^[A-Za-z][A-Za-z0-9._+/-]*$/.test(payload.timeZone) ||
          !isTimeZone(payload.timeZone))
      )
        errors.push("Часовой пояс указан неверно");
      const start = payload.preferredCallStart,
        end = payload.preferredCallEnd;
      if (
        (start || end) &&
        (!payload.timeZone ||
          !start ||
          !end ||
          start === end ||
          !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(start) ||
          !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(end))
      )
        errors.push(
          "Время звонка: нужны часовой пояс и разные часы начала и окончания",
        );
    }
    if (sheet.formulaRows.includes(line))
      errors.push("Формулы в файле запрещены");
    if (
      sheet.numericColumnsByRow[line]?.some(
        (h) =>
          h === mapping.externalId ||
          h === mapping.inn ||
          h === mapping.kpp ||
          h === mapping.ogrn ||
          h === mapping.phone ||
          h === mapping.companyExternalId,
      )
    )
      errors.push(
        "Идентификаторы в XLSX должны быть текстом, чтобы сохранить ведущие нули",
      );
    const unmapped = Object.fromEntries(
      Object.entries(raw)
        .filter(
          ([header, value]) =>
            !Object.values(mapping).includes(header) && value.trim(),
        )
        .map(([h, v]) => {
          const normalized = v.replace(/\r\n?/g, "\n").trim();
          if (
            /[\x00-\x1f\x7f]/.test(h) ||
            /[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/.test(normalized)
          )
            errors.push("Дополнительный столбец содержит недопустимые символы");
          return [h, normalized];
        }),
    );
    if (Object.keys(unmapped).length) {
      if (entity === "contacts") {
        const suffix = Object.entries(unmapped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([h, v]) => `${h}: ${v}`)
          .join("\n");
        const notes = [payload.notes, suffix].filter(Boolean).join("\n");
        if (notes.length > 5000)
          errors.push(
            "Заметки вместе с исходными полями превышают 5000 символов",
          );
        else payload.notes = notes;
        warnings.push(
          `Дополнительные поля (${Object.keys(unmapped).length}) сохранены в заметках`,
        );
      } else
        warnings.push(
          `Не сопоставлены дополнительные поля: ${Object.keys(unmapped).length}`,
        );
    }
    return { payload, errors, warnings, unmapped };
  }
  async preview(context: CustomersAuthorization, input: PreviewInput) {
    this.access(context, input.workspaceId, true);
    const file = this.basic(input);
    const sourceKey = requiredText(input.sourceKey, "sourceKey", 100);
    const sheetName = requiredText(input.sheet, "sheet", 200);
    const sheet = file.sheets.find((s) => s.name === sheetName);
    if (!sheet) fail("Sheet not found");
    const mapping = this.validateMapping(input, sheet);
    const options = ownKeys(input.options || {}, ["teamId"], "options");
    const teamId =
      options.teamId === undefined ? null : id(options.teamId, "teamId");
    if (teamId && !context.teamIds.includes(teamId))
      throw new ForbiddenException("Team is not authorized");
    const decisions = input.decisions || [];
    if (!Array.isArray(decisions) || decisions.length > 500)
      fail("Invalid decisions");
    const decisionByRow = new Map<
      number,
      {
        row: number;
        action: "SKIP" | "LINK";
        existingId?: string;
        expectedVersion?: number;
      }
    >();
    for (const decision of decisions) {
      ownKeys(
        decision,
        ["row", "action", "existingId", "expectedVersion"],
        "decision",
      );
      if (
        !Number.isInteger(decision.row) ||
        decision.row < 2 ||
        decisionByRow.has(decision.row) ||
        !["SKIP", "LINK"].includes(decision.action)
      )
        fail("Invalid decision row");
      if (
        decision.action === "LINK" &&
        (!UUID.test(decision.existingId || "") ||
          !Number.isInteger(decision.expectedVersion) ||
          !decision.expectedVersion ||
          decision.expectedVersion < 1)
      )
        fail("LINK needs ID and version");
      if (
        decision.action === "SKIP" &&
        (decision.existingId !== undefined ||
          decision.expectedVersion !== undefined)
      )
        fail("SKIP must not name target");
      decisionByRow.set(decision.row, decision);
    }
    const rows: ImportRow[] = [];
    const seen = new Set<string>();
    const seenNatural = new Set<string>();
    for (let i = 0; i < sheet.rows.length; i++) {
      const line = sheet.rowNumbers[i],
        raw = sheet.rows[i],
        normalized = this.normalize(input.entity, raw, mapping, sheet, line),
        p = normalized.payload;
      const sourceId = p.externalId || `sha256:${hash(p)}`;
      const errors = [...normalized.errors],
        warnings = [
          ...normalized.warnings,
          "Ответственным станет текущий пользователь; назначение из файла не переносится",
        ];
      if (seen.has(sourceId)) errors.push("Внешний ID повторяется в файле");
      seen.add(sourceId);
      const ph = payloadHash(p);
      let action: ImportAction = "CREATE",
        targetId: string | null = null,
        expectedVersion: number | null = null,
        companyId: string | null = null,
        companyVersion: number | null = null;
      let companyName: string | null = null;
      let candidates: Candidate[] = [];
      const decision = decisionByRow.get(line);
      if (decision?.action === "SKIP") {
        const values: Record<string, string | null> = {
          ...p,
          responsible: context.subject,
          sourceId,
          ...(input.entity === "contacts" ? { companyName: null } : {}),
        };
        for (const [header, value] of Object.entries(normalized.unmapped))
          values[`source:${header}`] = value;
        if (
          Object.keys(normalized.unmapped).length &&
          input.entity === "companies"
        )
          values.unmappedColumns = Object.keys(normalized.unmapped).join(", ");
        rows.push({
          row: line,
          sourceId,
          action: "SKIP",
          targetId: null,
          expectedVersion: null,
          values,
          errors: [],
          warnings,
          candidates: [],
          payload: p,
          payloadHash: ph,
          companyId: null,
          companyVersion: null,
          teamId: null,
          unmapped: normalized.unmapped,
        });
        continue;
      }
      const binding = await this.db.importBinding.findUnique({
        where: {
          workspaceId_sourceKey_entity_externalId: {
            workspaceId: context.workspaceId,
            sourceKey,
            entity: input.entity,
            externalId: sourceId,
          },
        },
      });
      if (binding) {
        const target = binding.companyId
          ? await this.db.company.findFirst({
              where: { AND: [scope(context), { id: binding.companyId }] },
            })
          : await this.db.contact.findFirst({
              where: { AND: [scope(context), { id: binding.contactId! }] },
            });
        if (!target) errors.push("Ранее связанная запись недоступна");
        else if (binding.payloadHash !== ph)
          errors.push(
            "Данные этого внешнего ID изменились; импорт не обновляет записи",
          );
        else {
          action = "SKIP";
          targetId = target.id;
          expectedVersion = target.version;
          warnings.push("Запись уже импортирована без изменений");
        }
      } else {
        if (input.entity === "companies" && p.inn) {
          const matches = await this.db.company.findMany({
            where: { AND: [scope(context), { inn: p.inn }] },
            take: 3,
          });
          candidates = matches.map((m) => ({
            id: m.id,
            name: m.name,
            version: m.version,
          }));
        }
        if (input.entity === "contacts" && (p.phone || p.email)) {
          const terms: Prisma.ContactWhereInput[] = [];
          if (p.phone) terms.push({ phone: p.phone });
          if (p.email) terms.push({ email: p.email });
          const matches = await this.db.contact.findMany({
            where: { AND: [scope(context), { OR: terms }] },
            take: 3,
          });
          candidates = matches.map((m) => ({
            id: m.id,
            name: m.name,
            version: m.version,
          }));
        }
        if (candidates.length > 1)
          errors.push("Найдено несколько точных совпадений; выберите связь или пропуск");
        else if (candidates.length === 1)
          errors.push("Найдено точное совпадение; выберите связь или пропуск");
      }
      if (action !== "SKIP" && input.entity === "contacts") {
        if (p.companyId || p.companyExternalId) {
          const companyBinding = p.companyExternalId
            ? await this.db.importBinding.findUnique({
                where: {
                  workspaceId_sourceKey_entity_externalId: {
                    workspaceId: context.workspaceId,
                    sourceKey,
                    entity: "companies",
                    externalId: p.companyExternalId,
                  },
                },
              })
            : null;
          const ref =
            p.companyId && UUID.test(p.companyId)
              ? p.companyId
              : companyBinding?.companyId || null;
          const company = ref
            ? await this.db.company.findFirst({
                where: { AND: [scope(context), { id: ref }] },
              })
            : null;
          if (!company) errors.push("Компания не найдена или недоступна");
          else {
            companyId = company.id;
            companyVersion = company.version;
            companyName = company.name;
          }
        }
      }
      if (decision?.action === "LINK") {
        if (binding) errors.push("Внешний ID уже связан с записью");
        else {
          const existing =
            input.entity === "companies"
              ? await this.db.company.findFirst({
                  where: { AND: [scope(context), { id: decision.existingId }] },
                })
              : await this.db.contact.findFirst({
                  where: { AND: [scope(context), { id: decision.existingId }] },
                });
          if (!existing || existing.version !== decision.expectedVersion)
            errors.push("Выбранная запись недоступна или изменилась");
          else if (
            candidates.length &&
            !candidates.some((c) => c.id === existing.id)
          )
            errors.push("Для связи выберите доступное точное совпадение");
          else {
            action = "LINK";
            targetId = existing.id;
            expectedVersion = existing.version;
            errors.splice(
              0,
              errors.length,
              ...errors.filter(
                (e) =>
                  !e.startsWith("Найдено точное совпадение") &&
                  !e.startsWith("Найдено несколько точных совпадений"),
              ),
            );
          }
        }
      }
      if (action !== "SKIP" && errors.length === 0) {
        const naturalKeys =
          input.entity === "companies"
            ? p.inn
              ? [`inn:${p.inn}`]
              : []
            : [
                p.phone && `phone:${p.phone}`,
                p.email && `email:${p.email}`,
              ].filter((key): key is string => Boolean(key));
        if (naturalKeys.some((key) => seenNatural.has(key)))
          errors.push("В файле повторяется ИНН, телефон или электронная почта");
        else naturalKeys.forEach((key) => seenNatural.add(key));
      }
      if (errors.length) action = "ERROR";
      const values: Record<string, string | null> = {
        ...p,
        responsible: context.subject,
        sourceId,
        ...(input.entity === "contacts" ? { companyName } : {}),
      };
      for (const [header, value] of Object.entries(normalized.unmapped))
        values[`source:${header}`] = value;
      if (
        Object.keys(normalized.unmapped).length &&
        input.entity === "companies"
      )
        values.unmappedColumns = Object.keys(normalized.unmapped).join(", ");
      rows.push({
        row: line,
        sourceId,
        action,
        targetId,
        expectedVersion,
        values,
        errors,
        warnings,
        candidates,
        payload: p,
        payloadHash: ph,
        companyId,
        companyVersion,
        teamId: action === "SKIP" ? null : teamId,
        unmapped: normalized.unmapped,
      });
    }
    if (decisions.some((d) => !rows.some((r) => r.row === d.row)))
      fail("Decision row not found");
    const expiresAt = new Date(Date.now() + 24 * 3600_000);
    const preview = await this.db.importPreview.create({
      data: {
        workspaceId: context.workspaceId,
        actorSubject: context.subject,
        entity: input.entity,
        sourceKey,
        fileDigest: file.digest,
        rows: rows as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });
    return {
      schemaVersion: 1,
      workspaceId: context.workspaceId,
      previewId: preview.id,
      entity: input.entity,
      sourceKey,
      expiresAt: expiresAt.toISOString(),
      rows: rows.map(publicRow),
      summary: summary(rows),
      result: null,
    };
  }
  async get(
    context: CustomersAuthorization,
    previewId: string,
    workspaceId: string,
  ) {
    this.access(context, workspaceId, false);
    id(previewId, "previewId");
    const preview = await this.db.importPreview.findFirst({
      where: { id: previewId, workspaceId, actorSubject: context.subject },
    });
    if (!preview)
      throw new NotFoundException("Preview not found");
    const rows = preview.rows as unknown as ImportRow[];
    let visibleRows: ReturnType<typeof publicRow>[];
    if (preview.result) {
      await this.ensureResultVisible(
        context,
        preview.result as unknown as ApplyResult,
        preview.entity as ImportEntity,
      );
      visibleRows = await this.appliedRows(context, rows, preview.entity as ImportEntity);
    } else {
      await this.ensureVisible(context, rows, preview.entity as ImportEntity);
      visibleRows = rows.map(publicRow);
    }
    return {
      schemaVersion: 1,
      workspaceId,
      previewId,
      entity: preview.entity,
      sourceKey: preview.sourceKey,
      expiresAt: preview.expiresAt.toISOString(),
      rows: visibleRows,
      summary: summary(rows),
      result: preview.result,
    };
  }
  private async appliedRows(
    context: CustomersAuthorization,
    rows: ImportRow[],
    entity: ImportEntity,
  ) {
    const visibleRows: ReturnType<typeof publicRow>[] = [];
    for (const row of rows) {
      const visible = publicRow(row);
      if (row.companyId) {
        const company = await this.db.company.findFirst({
          where: { AND: [scope(context), { id: row.companyId }] },
          select: { id: true },
        });
        if (!company)
          visible.values = { ...visible.values, companyName: null };
      }
      if (row.targetId) {
        const target =
          entity === "companies"
            ? await this.db.company.findFirst({
                where: { AND: [scope(context), { id: row.targetId }] },
                select: { id: true },
              })
            : await this.db.contact.findFirst({
                where: { AND: [scope(context), { id: row.targetId }] },
                select: { id: true },
              });
        if (!target) {
          visible.targetId = null;
          visible.expectedVersion = null;
        }
      }
      const candidates: Candidate[] = [];
      for (const candidate of row.candidates) {
        const target =
          entity === "companies"
            ? await this.db.company.findFirst({
                where: { AND: [scope(context), { id: candidate.id }] },
                select: { id: true },
              })
            : await this.db.contact.findFirst({
                where: { AND: [scope(context), { id: candidate.id }] },
                select: { id: true },
              });
        if (target) candidates.push(candidate);
      }
      visible.candidates = candidates;
      visibleRows.push(visible);
    }
    return visibleRows;
  }
  private async ensureVisible(
    context: CustomersAuthorization,
    rows: ImportRow[],
    entity: ImportEntity,
  ) {
    for (const row of rows) {
      if (row.teamId && !context.teamIds.includes(row.teamId))
        throw new NotFoundException("Preview not found");
      if (row.companyId) {
        const company = await this.db.company.findFirst({
          where: { AND: [scope(context), { id: row.companyId }] },
          select: { id: true },
        });
        if (!company) throw new NotFoundException("Preview not found");
      }
      for (const targetId of [
        row.targetId,
        ...row.candidates.map((candidate) => candidate.id),
      ]) {
        if (!targetId) continue;
        const target =
          entity === "companies"
            ? await this.db.company.findFirst({
                where: { AND: [scope(context), { id: targetId }] },
              })
            : await this.db.contact.findFirst({
                where: { AND: [scope(context), { id: targetId }] },
              });
        if (!target) throw new NotFoundException("Preview not found");
      }
    }
  }
  private async ensureResultVisible(
    context: CustomersAuthorization,
    result: ApplyResult,
    entity: ImportEntity,
  ) {
    for (const item of result.items) {
      if (!item.entityId) continue;
      const target =
        entity === "companies"
          ? await this.db.company.findFirst({
              where: { AND: [scope(context), { id: item.entityId }] },
            })
          : await this.db.contact.findFirst({
              where: { AND: [scope(context), { id: item.entityId }] },
            });
      if (!target) throw new NotFoundException("Preview not found");
    }
  }
  async apply(context: CustomersAuthorization, input: ApplyInput) {
    this.access(context, input.workspaceId, true);
    if (input.schemaVersion !== 1) fail("Invalid schemaVersion");
    const previewId = id(input.previewId, "previewId"),
      commandId = id(input.commandId, "commandId");
    const requestHash = hash({
      schemaVersion: 1,
      workspaceId: context.workspaceId,
      previewId,
      commandId,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-customers:import-command:${commandId}`},0))`,
            );
            const used = await tx.importPreview.findFirst({
              where: { commitCommandId: commandId },
            });
            if (
              used &&
              (used.id !== previewId ||
                used.workspaceId !== context.workspaceId ||
                used.actorSubject !== context.subject ||
                used.requestHash !== requestHash)
            )
              conflict("Command ID was used for another import");
            await tx.$executeRaw`SELECT crm_customers.assert_workspace_open(${context.workspaceId}::uuid)`;
            await tx.$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-customers:workspace:${context.workspaceId}`},0))`,
            );
            const preview = await tx.importPreview.findFirst({
              where: {
                id: previewId,
                workspaceId: context.workspaceId,
                actorSubject: context.subject,
              },
            });
            if (!preview) throw new NotFoundException("Preview not found");
            if (preview.result) {
              if (
                preview.commitCommandId !== commandId ||
                preview.requestHash !== requestHash
              )
                conflict("Preview already applied by another command");
              const priorResult = preview.result as unknown as ApplyResult;
              for (const item of priorResult.items)
                if (item.entityId) {
                  const target =
                    preview.entity === "companies"
                      ? await tx.company.findFirst({
                          where: {
                            AND: [scope(context), { id: item.entityId }],
                          },
                        })
                      : await tx.contact.findFirst({
                          where: {
                            AND: [scope(context), { id: item.entityId }],
                          },
                        });
                  if (!target) throw new NotFoundException("Preview not found");
                }
              return preview.result as unknown as ApplyResult;
            }
            if (preview.expiresAt.getTime() < Date.now())
              conflict("Preview expired");
            const rows = preview.rows as unknown as ImportRow[];
            if (
              !Array.isArray(rows) ||
              rows.length > 500 ||
              rows.some((row) => row.action === "ERROR" || row.errors.length)
            )
              fail("Preview contains errors");
            const entity = preview.entity as ImportEntity;
            if (
              rows.some(
                (row) => row.teamId && !context.teamIds.includes(row.teamId),
              )
            )
              throw new ForbiddenException("Team is not authorized");
            const items: ApplyResult["items"] = [];
            for (const row of rows) {
              if (row.action === "SKIP") {
                if (row.targetId) {
                  const target =
                    entity === "companies"
                      ? await tx.company.findFirst({
                          where: {
                            AND: [
                              scope(context),
                              {
                                id: row.targetId,
                                version: row.expectedVersion!,
                              },
                            ],
                          },
                        })
                      : await tx.contact.findFirst({
                          where: {
                            AND: [
                              scope(context),
                              {
                                id: row.targetId,
                                version: row.expectedVersion!,
                              },
                            ],
                          },
                        });
                  if (!target)
                    conflict("Bound target changed or is unavailable");
                }
                items.push({
                  row: row.row,
                  sourceId: row.sourceId,
                  entityId: null,
                  action: "SKIP",
                });
                continue;
              }
              if (!row.sourceId) fail("Preview missing source ID");
              const binding = await tx.importBinding.findUnique({
                where: {
                  workspaceId_sourceKey_entity_externalId: {
                    workspaceId: context.workspaceId,
                    sourceKey: preview.sourceKey,
                    entity,
                    externalId: row.sourceId,
                  },
                },
              });
              if (binding) conflict("Source binding changed after preview");
              if (entity === "contacts" && row.companyId) {
                const company = await tx.company.findFirst({
                  where: {
                    AND: [
                      scope(context),
                      { id: row.companyId, version: row.companyVersion! },
                    ],
                  },
                });
                if (!company)
                  conflict("Company reference changed or is unavailable");
              }
              let entityId: string;
              if (row.action === "LINK") {
                if (!row.targetId || !row.expectedVersion)
                  fail("Preview missing LINK target");
                const target =
                  entity === "companies"
                    ? await tx.company.findFirst({
                        where: {
                          AND: [
                            scope(context),
                            { id: row.targetId, version: row.expectedVersion! },
                          ],
                        },
                      })
                    : await tx.contact.findFirst({
                        where: {
                          AND: [
                            scope(context),
                            { id: row.targetId, version: row.expectedVersion! },
                          ],
                        },
                      });
                if (!target) conflict("LINK target changed or is unavailable");
                entityId = target.id;
              } else {
                const p = row.payload;
                if (entity === "companies") {
                  if (
                    p.inn &&
                    (await tx.company.findFirst({
                      where: { AND: [scope(context), { inn: p.inn }] },
                      select: { id: true },
                    }))
                  )
                    conflict(
                      "Компания с таким ИНН появилась после предпросмотра",
                    );
                  const created = await tx.company.create({
                    data: {
                      workspaceId: context.workspaceId,
                      createdBySubject: context.subject,
                      teamId: row.teamId,
                      name: p.name!,
                      inn: p.inn,
                      website: p.website,
                      legalName: p.legalName,
                      kpp: p.kpp,
                      ogrn: p.ogrn,
                      legalAddress: p.legalAddress,
                      entityType: p.entityType,
                      notes: p.notes,
                    },
                  });
                  entityId = created.id;
                } else {
                  const exactContacts: Prisma.ContactWhereInput[] = [];
                  if (p.phone) exactContacts.push({ phone: p.phone });
                  if (p.email) exactContacts.push({ email: p.email });
                  if (
                    exactContacts.length &&
                    (await tx.contact.findFirst({
                      where: { AND: [scope(context), { OR: exactContacts }] },
                      select: { id: true },
                    }))
                  )
                    conflict(
                      "Контакт с таким телефоном или почтой появился после предпросмотра",
                    );
                  const created = await tx.contact.create({
                    data: {
                      workspaceId: context.workspaceId,
                      createdBySubject: context.subject,
                      teamId: row.teamId,
                      name: p.name!,
                      phone: p.phone,
                      email: p.email,
                      companyId: row.companyId,
                      timeZone: p.timeZone,
                      preferredCallStart: p.preferredCallStart,
                      preferredCallEnd: p.preferredCallEnd,
                      notes: p.notes,
                    },
                  });
                  entityId = created.id;
                }
                await tx.customerActivity.create({
                  data: {
                    workspaceId: context.workspaceId,
                    entityId,
                    entityKind: entity === "companies" ? "company" : "contact",
                    commandId: randomUUID(),
                    actorSubject: context.subject,
                    action: "CREATED",
                    entityVersion: 1,
                    changedFields: Object.keys(p).filter(
                      (key) =>
                        p[key] !== null &&
                        ![
                          "externalId",
                          "firstName",
                          "middleName",
                          "lastName",
                          "companyExternalId",
                        ].includes(key),
                    ),
                  },
                });
              }
              await tx.importBinding.create({
                data: {
                  workspaceId: context.workspaceId,
                  sourceKey: preview.sourceKey,
                  entity,
                  externalId: row.sourceId,
                  payloadHash: row.payloadHash,
                  companyId: entity === "companies" ? entityId : null,
                  contactId: entity === "contacts" ? entityId : null,
                },
              });
              items.push({
                row: row.row,
                sourceId: row.sourceId,
                entityId,
                action: row.action as "CREATE" | "LINK",
              });
            }
            const result: ApplyResult = {
              schemaVersion: 1,
              previewId,
              commandId,
              entity,
              status: "APPLIED",
              created: items.filter((i) => i.action === "CREATE").length,
              linked: items.filter((i) => i.action === "LINK").length,
              skipped: items.filter((i) => i.action === "SKIP").length,
              items,
            };
            const updated = await tx.importPreview.updateMany({
              where: {
                id: previewId,
                workspaceId: context.workspaceId,
                actorSubject: context.subject,
                commitCommandId: null,
              },
              data: {
                commitCommandId: commandId,
                requestHash,
                result: result as unknown as Prisma.InputJsonObject,
              },
            });
            if (updated.count !== 1) conflict("Preview changed concurrently");
            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 60000,
            maxWait: 5000,
          },
        );
      } catch (error) {
        if (String(error).includes("crm_workspace_closed"))
          throw new ForbiddenException({
            code: "crm_workspace_closed",
            message: "Workspace is closed",
          });
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (["P2034", "P2002"].includes(error.code) ||
            (error.code === "P2010" &&
              ["40001", "40P01"].includes(String(error.meta?.code))))
        ) {
          if (attempt < 2) continue;
          throw new ServiceUnavailableException({
            code: "crm_import_retry_required",
            message: "Retry same command ID",
          });
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException("Import unavailable");
  }
  async resolve(context: CustomersAuthorization, input: ResolveInput) {
    this.access(context, input.workspaceId, false);
    if (input.schemaVersion !== 1) fail("Invalid schemaVersion");
    const sourceKey = requiredText(input.sourceKey, "sourceKey", 100);
    if (!Array.isArray(input.references) || input.references.length > 500)
      fail("Too many references");
    const items = [];
    for (let index = 0; index < input.references.length; index++) {
      const ref = ownKeys(
        input.references[index],
        ["kind", "externalId", "id"],
        "reference",
      );
      if (
        ref.kind !== "contact" ||
        (ref.externalId === undefined) === (ref.id === undefined)
      )
        fail("Reference needs exactly one contact identifier");
      let contactId: string | null = null;
      if (ref.id !== undefined) contactId = id(ref.id, "contact id");
      else {
        const externalId = requiredText(ref.externalId, "externalId", 256);
        const binding = await this.db.importBinding.findUnique({
          where: {
            workspaceId_sourceKey_entity_externalId: {
              workspaceId: context.workspaceId,
              sourceKey,
              entity: "contacts",
              externalId,
            },
          },
        });
        contactId = binding?.contactId || null;
      }
      const contact = contactId
        ? await this.db.contact.findFirst({
            where: { AND: [scope(context), { id: contactId }] },
            select: { id: true, name: true, version: true },
          })
        : null;
      items.push({
        index,
        contact: contact || null,
        error: contact ? null : "Contact unresolved",
      });
    }
    return { schemaVersion: 1, items };
  }
}
