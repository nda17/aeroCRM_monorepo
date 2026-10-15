import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { SaveActivityTextTemplatesDto } from "./activity-text-templates.dto";

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const template = {
  id: "d6249dca-c181-4ed8-8f31-83c263a7459e",
  title: "Follow up",
  body: "Hello\tthere\r\nnext line\r",
  archived: false,
};
const command = {
  schemaVersion: 1,
  workspaceId: "b531b13e-3624-4ec5-b66d-f24373b0b374",
  commandId: "b1c1d3d9-dc5a-4a50-98ba-c79b3895db62",
  expectedVersion: 0,
  templates: [template],
};

describe("SaveActivityTextTemplatesDto", () => {
  it("accepts exact normalized-input boundaries and permitted body controls", async () => {
    await expect(
      pipe.transform(command, {
        type: "body",
        metatype: SaveActivityTextTemplatesDto,
      }),
    ).resolves.toMatchObject(command);
  });

  it.each([
    { title: "bad\nname" },
    { title: "bad\u007fname" },
    { body: "bad\u0000body" },
    { body: "bad\u000bbody" },
    { body: "bad\u007fbody" },
    { body: "   " },
    { title: " ".repeat(201) },
    { body: "x".repeat(4001) },
    { expectedVersion: 2147483647 },
    { expectedVersion: -1 },
    { expectedVersion: 1.5 },
    { schemaVersion: 2 },
    { actorSubject: "client-controlled" },
    { templates: [{ ...template, injected: true }] },
  ])("rejects invalid bounds and unknown keys %#", async (patch) => {
    const value = {
      ...command,
      ...patch,
      templates: patch.templates ?? [
        {
          ...template,
          ...("title" in patch ? { title: patch.title } : {}),
          ...("body" in patch ? { body: patch.body } : {}),
        },
      ],
    };
    await expect(
      pipe.transform(value, {
        type: "body",
        metatype: SaveActivityTextTemplatesDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enforces collection size and case-insensitive UUID uniqueness", async () => {
    const tooMany = Array.from({ length: 101 }, (_, index) => ({
      ...template,
      id: `d6249dca-c181-4ed8-8f31-83c263a7${String(index).padStart(4, "0")}`,
    }));
    for (const templates of [
      tooMany,
      [template, { ...template, id: template.id.toUpperCase() }],
    ])
      await expect(
        pipe.transform(
          { ...command, templates },
          { type: "body", metatype: SaveActivityTextTemplatesDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects malformed nested ids with a validation error instead of throwing", async () => {
    for (const item of [null, 7, {}, { ...template, id: 123 }])
      await expect(
        pipe.transform(
          { ...command, templates: [item] },
          { type: "body", metatype: SaveActivityTextTemplatesDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
  });
});
