import { BadRequestException } from "@nestjs/common";
import {
  parseImportApply,
  parseImportGetQuery,
  parseImportInspect,
  parseImportPreview,
} from "./import.dto";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const previewId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const validFile = {
  schemaVersion: 1,
  workspaceId,
  entity: "deals" as const,
  filename: "deals.xlsx",
  contentBase64: "YQ==",
};

describe("Sales import request parsers", () => {
  it("strictly parses deal inspection and rejects unknown keys or another entity", () => {
    expect(parseImportInspect(validFile)).toEqual(validFile);
    expect(() => parseImportInspect({ ...validFile, surprise: true })).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseImportInspect({ ...validFile, entity: "contacts" }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseImportInspect({ ...validFile, filename: "deals.xls" }),
    ).toThrow(BadRequestException);
  });

  it("validates complete stage mapping and LINK decision concurrency fields", () => {
    const preview = {
      ...validFile,
      sourceKey: "bitrix-main",
      sheet: "Deals",
      mapping: {
        externalId: "ID",
        title: "Title",
        contactExternalId: "Contact",
      },
      options: {
        pipelineId: previewId,
        stageMapping: { Qualified: commandId },
      },
      decisions: [
        {
          row: 501,
          action: "LINK" as const,
          existingId: workspaceId,
          expectedVersion: 3,
        },
      ],
    };
    expect(parseImportPreview(preview)).toMatchObject({
      sourceKey: "bitrix-main",
      options: preview.options,
      decisions: preview.decisions,
    });
    expect(() =>
      parseImportPreview({
        ...preview,
        options: { stageMapping: { Qualified: "bad" } },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseImportPreview({
        ...preview,
        decisions: [{ row: 501, action: "LINK", existingId: workspaceId }],
      }),
    ).toThrow(BadRequestException);
    expect(() => parseImportPreview({ ...preview, surprise: true })).toThrow(
      BadRequestException,
    );
  });

  it("strictly validates apply command and GET query", () => {
    const apply = { schemaVersion: 1, workspaceId, previewId, commandId };
    expect(parseImportApply(apply)).toEqual(apply);
    expect(() => parseImportApply({ ...apply, schemaVersion: 2 })).toThrow(
      BadRequestException,
    );
    expect(parseImportGetQuery({ workspaceId })).toEqual({ workspaceId });
    expect(() => parseImportGetQuery({ workspaceId, previewId })).toThrow(
      BadRequestException,
    );
  });
});
