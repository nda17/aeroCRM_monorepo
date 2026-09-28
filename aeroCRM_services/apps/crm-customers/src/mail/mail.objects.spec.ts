import {
  boundedBytes,
  safeMailFilename,
  validateMailBytes,
  validateOoxml,
} from "./mail.objects";

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

describe("mail attachment validation", () => {
  it("bounds streamed object reads before concatenating untrusted data", async () => {
    async function* chunks() {
      yield Buffer.from("abc");
      yield Buffer.from("def");
    }
    expect(await boundedBytes(chunks(), 6)).toEqual(Buffer.from("abcdef"));
    await expect(boundedBytes(chunks(), 5)).rejects.toThrow(
      "MAIL_FILE_TOO_LARGE",
    );
  });

  it("normalizes dangerous filename controls and path separators", () => {
    expect(safeMailFilename("../folder/evil\u202e.txt")).toBe(
      ".._folder_evil_.txt",
    );
    expect(safeMailFilename("\u0000\r\n")).toBe("___");
  });

  it("rejects extension spoofing, unsupported formats, and oversized attachments", async () => {
    await expect(
      validateMailBytes(Buffer.from("hello"), "payload.pdf", "text/plain"),
    ).rejects.toThrow("MAIL_FILE_TYPE_REJECTED");
    await expect(
      validateMailBytes(Buffer.from("hello"), "script.html", "text/html"),
    ).rejects.toThrow("MAIL_FILE_TYPE_REJECTED");
    await expect(
      validateMailBytes(
        Buffer.alloc(5 * 1024 * 1024 + 1, 97),
        "large.txt",
        "text/plain",
      ),
    ).rejects.toThrow("MAIL_FILE_TOO_LARGE");
  });

  it("accepts ordinary UTF-8 text but rejects invalid UTF-8 and binary/control payloads", async () => {
    await expect(
      validateMailBytes(Buffer.from("Привет\n"), "note.txt", "text/plain"),
    ).resolves.toBe("text/plain");
    await expect(
      validateMailBytes(Buffer.from([0xc3, 0x28]), "note.txt", "text/plain"),
    ).rejects.toThrow();
    await expect(
      validateMailBytes(
        Buffer.from("hello\u0000world"),
        "note.txt",
        "text/plain",
      ),
    ).rejects.toThrow("MAIL_TEXT_REJECTED");
    await expect(
      validateMailBytes(
        Buffer.from("<!doctype html>"),
        "note.txt",
        "text/plain",
      ),
    ).rejects.toThrow("MAIL_TEXT_REJECTED");
  });

  it("accepts a bounded OOXML document and rejects external relationships, macro content, and non-OOXML ZIPs", async () => {
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
    ).rejects.toThrow("MAIL_OOXML_REJECTED");
    await expect(
      validateOoxml(docx([["word/vbaProject.bin", "executable"]]), "docx"),
    ).rejects.toThrow("MAIL_OOXML_REJECTED");
    await expect(
      validateOoxml(zip([["readme.txt", "not Office"]]), "docx"),
    ).rejects.toThrow();
  });
});
