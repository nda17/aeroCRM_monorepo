import { BadRequestException } from "@nestjs/common";

export type ImportEntity = "companies" | "contacts";
export type ImportDecision = {
  row: number;
  action: "SKIP" | "LINK";
  existingId?: string;
  expectedVersion?: number;
};
export type ImportInspectInput = {
  schemaVersion: 1;
  workspaceId: string;
  entity: ImportEntity;
  filename: string;
  contentBase64: string;
};
export type ImportPreviewInput = ImportInspectInput & {
  sourceKey: string;
  sheet: string;
  mapping: Record<string, string>;
  options?: {
    teamId?: string;
    pipelineId?: string;
    stageId?: string;
    stageMapping?: Record<string, string>;
  };
  decisions?: ImportDecision[];
};
export type ImportApplyInput = {
  schemaVersion: 1;
  workspaceId: string;
  previewId: string;
  commandId: string;
};
export type ImportGetQuery = { workspaceId: string };
export type ImportResolveInput = {
  schemaVersion: 1;
  workspaceId: string;
  sourceKey: string;
  references: Array<{
    kind: "contact";
    externalId?: string;
    id?: string;
  }>;
};

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const badRequest = (): never => {
  throw new BadRequestException("Некорректные данные импорта");
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) => Object.keys(value).every((key) => allowed.includes(key));
const uuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_V4.test(value);
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value);
const count = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const parseBase = (
  value: unknown,
  entityRequired = true,
): ImportInspectInput => {
  if (
    !record(value) ||
    !exactKeys(value, [
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
    ]) ||
    value.schemaVersion !== 1 ||
    !uuid(value.workspaceId) ||
    (entityRequired &&
      !["companies", "contacts"].includes(String(value.entity))) ||
    !boundedText(value.filename, 200) ||
    (!value.filename.toLowerCase().endsWith(".csv") &&
      !value.filename.toLowerCase().endsWith(".xlsx")) ||
    typeof value.contentBase64 !== "string" ||
    value.contentBase64.length < 4 ||
    value.contentBase64.length > 1_333_344 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.contentBase64,
    )
  )
    return badRequest();
  return {
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    entity: value.entity as ImportEntity,
    filename: value.filename,
    contentBase64: value.contentBase64,
  };
};

export function parseImportInspect(value: unknown): ImportInspectInput {
  const input = parseBase(value);
  if (
    record(value) &&
    ("sourceKey" in value ||
      "sheet" in value ||
      "mapping" in value ||
      "options" in value ||
      "decisions" in value)
  )
    return badRequest();
  return input;
}

export function parseImportPreview(value: unknown): ImportPreviewInput {
  const base = parseBase(value);
  if (
    !record(value) ||
    !boundedText(value.sourceKey, 100) ||
    !boundedText(value.sheet, 200) ||
    !record(value.mapping) ||
    Object.keys(value.mapping).length > 30
  )
    return badRequest();
  const mapping: Record<string, string> = {};
  for (const [field, header] of Object.entries(value.mapping)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field) || !boundedText(header, 200))
      return badRequest();
    mapping[field] = header;
  }
  let options: ImportPreviewInput["options"];
  if (value.options !== undefined) {
    if (
      !record(value.options) ||
      !exactKeys(value.options, [
        "teamId",
        "pipelineId",
        "stageId",
        "stageMapping",
      ])
    )
      return badRequest();
    const parsed: NonNullable<ImportPreviewInput["options"]> = {};
    for (const key of ["teamId", "pipelineId", "stageId"] as const) {
      const item = value.options[key];
      if (item !== undefined) {
        if (!uuid(item)) return badRequest();
        parsed[key] = item;
      }
    }
    if (value.options.stageMapping !== undefined) {
      if (
        !record(value.options.stageMapping) ||
        Object.keys(value.options.stageMapping).length > 100
      )
        return badRequest();
      const stageMapping: Record<string, string> = {};
      for (const [source, stageId] of Object.entries(
        value.options.stageMapping,
      )) {
        if (!boundedText(source, 100) || !uuid(stageId)) return badRequest();
        stageMapping[source] = stageId;
      }
      parsed.stageMapping = stageMapping;
    }
    options = parsed;
  }
  let decisions: ImportDecision[] | undefined;
  if (value.decisions !== undefined) {
    if (!Array.isArray(value.decisions) || value.decisions.length > 500)
      return badRequest();
    decisions = value.decisions.map((decision) => {
      if (
        !record(decision) ||
        !exactKeys(decision, [
          "row",
          "action",
          "existingId",
          "expectedVersion",
        ]) ||
        !count(decision.row, 2, 1_048_576) ||
        !["SKIP", "LINK"].includes(String(decision.action))
      )
        return badRequest();
      if (decision.action === "LINK") {
        if (
          !uuid(decision.existingId) ||
          !count(decision.expectedVersion, 1, 2_147_483_646)
        )
          return badRequest();
        return {
          row: decision.row,
          action: "LINK",
          existingId: decision.existingId,
          expectedVersion: decision.expectedVersion,
        };
      }
      if (
        decision.existingId !== undefined ||
        decision.expectedVersion !== undefined
      )
        return badRequest();
      return { row: decision.row, action: "SKIP" };
    });
    if (
      new Set(decisions.map((decision) => decision.row)).size !==
      decisions.length
    )
      return badRequest();
  }
  return {
    ...base,
    sourceKey: value.sourceKey,
    sheet: value.sheet,
    mapping,
    ...(options ? { options } : {}),
    ...(decisions ? { decisions } : {}),
  };
}

export function parseImportApply(value: unknown): ImportApplyInput {
  if (
    !record(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "workspaceId",
      "previewId",
      "commandId",
    ]) ||
    value.schemaVersion !== 1 ||
    !uuid(value.workspaceId) ||
    !uuid(value.previewId) ||
    !uuid(value.commandId)
  )
    return badRequest();
  return {
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    previewId: value.previewId,
    commandId: value.commandId,
  };
}

export function parseImportGetQuery(value: unknown): ImportGetQuery {
  if (
    !record(value) ||
    !exactKeys(value, ["workspaceId"]) ||
    !uuid(value.workspaceId)
  )
    return badRequest();
  return { workspaceId: value.workspaceId };
}

export function parseImportResolve(value: unknown): ImportResolveInput {
  if (
    !record(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "workspaceId",
      "sourceKey",
      "references",
    ]) ||
    value.schemaVersion !== 1 ||
    !uuid(value.workspaceId) ||
    !boundedText(value.sourceKey, 100) ||
    !Array.isArray(value.references) ||
    value.references.length > 500
  )
    return badRequest();
  const references = value.references.map((reference) => {
    if (
      !record(reference) ||
      !exactKeys(reference, ["kind", "externalId", "id"]) ||
      reference.kind !== "contact" ||
      (reference.id === undefined) === (reference.externalId === undefined)
    )
      return badRequest();
    if (reference.id !== undefined) {
      if (!uuid(reference.id)) return badRequest();
      return { kind: "contact" as const, id: reference.id };
    }
    if (!boundedText(reference.externalId, 256)) return badRequest();
    return { kind: "contact" as const, externalId: reference.externalId };
  });
  return {
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    sourceKey: value.sourceKey,
    references,
  };
}
