import { BadRequestException } from "@nestjs/common";
import {
  parseImportApply,
  parseImportGetQuery,
  parseImportInspect,
  parseImportPreview,
  parseImportResolve,
} from "./import.dto";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const previewId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const validFile = {
  schemaVersion: 1,
  workspaceId,
  entity: "contacts" as const,
  filename: "contacts.csv",
  contentBase64: "YQ==",
};

describe("Customers import request parsers", () => {
  it("strictly parses inspect and rejects unknown keys or unsupported entity", () => {
    expect(parseImportInspect(validFile)).toEqual(validFile);
    expect(() => parseImportInspect({ ...validFile, surprise: true })).toThrow(
      BadRequestException,
    );
    expect(() => parseImportInspect({ ...validFile, entity: "deals" })).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseImportInspect({ ...validFile, contentBase64: "***" }),
    ).toThrow(BadRequestException);
  });

  it("validates preview mapping, pipeline settings, and sparse physical row numbers", () => {
    const preview = {
      ...validFile,
      sourceKey: "google-personal",
      sheet: "Contacts",
      mapping: { name: "Name", email: "E-mail" },
      options: {
        teamId: commandId,
        pipelineId: previewId,
        stageId: workspaceId,
        stageMapping: { New: commandId },
      },
      decisions: [{ row: 10000, action: "SKIP" as const }],
    };
    expect(parseImportPreview(preview)).toMatchObject({
      sourceKey: "google-personal",
      decisions: preview.decisions,
    });
    expect(() =>
      parseImportPreview({
        ...preview,
        mapping: { name: "Name", extra: null },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseImportPreview({
        ...preview,
        decisions: [{ row: 2, action: "LINK", existingId: previewId }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseImportPreview({ ...preview, options: { teamId: "invalid" } }),
    ).toThrow(BadRequestException);
  });

  it("strictly validates command, query, and contact reference DTOs", () => {
    const apply = { schemaVersion: 1, workspaceId, previewId, commandId };
    expect(parseImportApply(apply)).toEqual(apply);
    expect(() => parseImportApply({ ...apply, commandId: "invalid" })).toThrow(
      BadRequestException,
    );
    expect(parseImportGetQuery({ workspaceId })).toEqual({ workspaceId });
    expect(() => parseImportGetQuery({ workspaceId, actor: "other" })).toThrow(
      BadRequestException,
    );
    expect(
      parseImportResolve({
        schemaVersion: 1,
        workspaceId,
        sourceKey: "bitrix",
        references: [
          { kind: "contact", externalId: "c-1" },
          { kind: "contact", id: previewId },
        ],
      }),
    ).toMatchObject({ references: [{ externalId: "c-1" }, { id: previewId }] });
    expect(() =>
      parseImportResolve({
        schemaVersion: 1,
        workspaceId,
        sourceKey: "bitrix",
        references: [{ kind: "contact" }],
      }),
    ).toThrow(BadRequestException);
  });
});
