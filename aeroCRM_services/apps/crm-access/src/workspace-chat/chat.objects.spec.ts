import sharp from "sharp";
import {
  boundedBytes,
  safeChatFilename,
  validateChatBytes,
  validateOoxml,
} from "./chat.objects";

const crc32 = (bytes: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const zip = (entries: Array<[string, string]>) => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name);
    const body = Buffer.from(content);
    const checksum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + body.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
};

const docx = (extra: Array<[string, string]> = []) =>
  zip([
    [
      "[Content_Types].xml",
      '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    ["word/document.xml", "<document><body><p/></body></document>"],
    ...extra,
  ]);

describe("chat attachment validation", () => {
  it("bounds streamed reads and sanitizes filename controls", async () => {
    async function* chunks() {
      yield Buffer.from("abc");
      yield Buffer.from("def");
    }
    expect(await boundedBytes(chunks(), 6)).toEqual(Buffer.from("abcdef"));
    await expect(boundedBytes(chunks(), 5)).rejects.toThrow(
      "CHAT_FILE_TOO_LARGE",
    );
    expect(safeChatFilename("../folder/evil\u202e.txt")).toBe(
      ".._folder_evil_.txt",
    );
    const bounded = safeChatFilename(`${"x".repeat(199)}😀.txt`);
    expect(bounded).toBe("x".repeat(199));
    expect(bounded.length).toBeLessThanOrEqual(200);
    expect(() => encodeURIComponent(bounded)).not.toThrow();
  });

  it("rejects MIME or extension spoofing and disallowed formats", async () => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await expect(
      validateChatBytes(png, "photo.png", "image/jpeg"),
    ).rejects.toThrow("CHAT_FILE_TYPE_REJECTED");
    await expect(
      validateChatBytes(Buffer.from("hello"), "payload.pdf", "text/plain"),
    ).rejects.toThrow("CHAT_FILE_TYPE_REJECTED");
    await expect(
      validateChatBytes(Buffer.from("hello"), "script.html", "text/html"),
    ).rejects.toThrow("CHAT_FILE_TYPE_REJECTED");
    await expect(
      validateChatBytes(
        Buffer.alloc(5 * 1024 * 1024 + 1, 97),
        "large.txt",
        "text/plain",
      ),
    ).rejects.toThrow("CHAT_FILE_TOO_LARGE");
  });

  it("decodes bounded images and rejects binary, HTML, and malformed text", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await expect(
      validateChatBytes(png, "photo.png", "image/png"),
    ).resolves.toBe("image/png");
    await expect(
      validateChatBytes(Buffer.from("Привет\n"), "note.txt", "text/plain"),
    ).resolves.toBe("text/plain");
    await expect(
      validateChatBytes(Buffer.from([0xc3, 0x28]), "note.txt", "text/plain"),
    ).rejects.toThrow();
    await expect(
      validateChatBytes(
        Buffer.from("hello\u0000world"),
        "note.txt",
        "text/plain",
      ),
    ).rejects.toThrow("CHAT_TEXT_REJECTED");
    await expect(
      validateChatBytes(
        Buffer.from("<!doctype html>"),
        "note.txt",
        "text/plain",
      ),
    ).rejects.toThrow("CHAT_TEXT_REJECTED");
  });

  it("accepts bounded OOXML and rejects external relationships, macros, and non-OOXML ZIPs", async () => {
    await expect(validateOoxml(docx(), "docx")).resolves.toBeUndefined();
    await expect(
      validateOoxml(
        docx([
          [
            "word/_rels/document.xml.rels",
            '<Relationships><Relationship TargetMode="External" Target="https://attacker.invalid/"/></Relationships>',
          ],
        ]),
        "docx",
      ),
    ).rejects.toThrow("CHAT_OOXML_REJECTED");
    await expect(
      validateOoxml(docx([["word/vbaProject.bin", "executable"]]), "docx"),
    ).rejects.toThrow("CHAT_OOXML_REJECTED");
    await expect(
      validateOoxml(zip([["readme.txt", "not Office"]]), "docx"),
    ).rejects.toThrow();
  });
});
