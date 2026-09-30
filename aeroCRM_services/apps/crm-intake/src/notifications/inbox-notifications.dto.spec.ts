import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InboxNotificationEntryReadDto } from "./inbox-notifications.dto";

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  validationError: { target: false, value: false },
});

describe("Inbox notification entry read DTO", () => {
  const body = { schemaVersion: 1, workspaceId: randomUUID() };
  const transform = (value: unknown) =>
    pipe.transform(value, {
      type: "body",
      metatype: InboxNotificationEntryReadDto,
    });

  it("accepts the versioned workspace-only contract", async () => {
    await expect(transform(body)).resolves.toMatchObject(body);
  });

  it.each([
    { schemaVersion: 2 },
    { schemaVersion: "1" },
    { workspaceId: "not-a-uuid" },
    { read: true },
    { recipientSubject: "forged" },
    { unknown: true },
  ])("rejects malformed or extra fields %j", async (override) => {
    await expect(transform({ ...body, ...override })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
