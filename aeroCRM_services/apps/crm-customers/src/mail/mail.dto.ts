import { Transform, Type } from "class-transformer";
import { isIP } from "node:net";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  isUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from "class-validator";

const ADDRESS_EMAIL = { allow_display_name: false } as const;
const HEADER_TEXT = /^[^\r\n\x00-\x1f\x7f]+$/;
const SAFE_LABEL = /^[^\x00-\x1f\x7f]*$/;

@ValidatorConstraint({ name: "mailRecipientsWithinLimit", async: false })
class MailRecipientsWithinLimit implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const body = args.object as Record<string, unknown>;
    return (
      ["to", "cc", "bcc"].reduce((total, key) => {
        const recipients = body[key];
        return total + (Array.isArray(recipients) ? recipients.length : 0);
      }, 0) <= 20
    );
  }
}

@ValidatorConstraint({ name: "mailSendRequiresRead", async: false })
class MailSendRequiresRead implements ValidatorConstraintInterface {
  validate(send: unknown, args: ValidationArguments) {
    return send !== true || (args.object as { read?: unknown }).read === true;
  }
}

@ValidatorConstraint({ name: "mailUtf8TextWithinLimit", async: false })
class MailUtf8TextWithinLimit implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const body = args.object as { html?: unknown };
    return (
      typeof value === "string" &&
      (body.html === undefined || typeof body.html === "string") &&
      Buffer.byteLength(value, "utf8") +
        (typeof body.html === "string" ? Buffer.byteLength(body.html, "utf8") : 0) <= 24 * 1024 &&
      Buffer.byteLength(JSON.stringify(args.object), "utf8") <= 32 * 1024
    );
  }
}

@ValidatorConstraint({ name: "mailNullableName", async: false })
class MailNullableName implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      value === null ||
      (typeof value === "string" &&
        value.length <= 200 &&
        SAFE_LABEL.test(value))
    );
  }
}

@ValidatorConstraint({ name: "mailNullableUuid", async: false })
class MailNullableUuid implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return value === null || (typeof value === "string" && isUUID(value, "4"));
  }
}

@ValidatorConstraint({ name: "mailNullablePassword", async: false })
class MailNullablePassword implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      value === null ||
      (typeof value === "string" &&
        value.length >= 1 &&
        value.length <= 1024 &&
        !/[\r\n\x00]/.test(value))
    );
  }
}

@ValidatorConstraint({ name: "mailPublicDnsHostname", async: false })
class MailPublicDnsHostname implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (typeof value !== "string" || value.length > 253) return false;
    if (isIP(value) !== 0) return false;
    const labels = value.split(".");
    if (
      labels.length < 2 ||
      labels.some(
        (label) =>
          label.length < 1 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
    )
      return false;
    const host = value.toLowerCase();
    return ![
      "localhost",
      ".localhost",
      ".local",
      ".internal",
      ".test",
      ".invalid",
      ".example",
      ".onion",
    ].some((suffix) => host === suffix || host.endsWith(suffix));
  }
}

@ValidatorConstraint({ name: "validMailImapTransport", async: false })
class ValidMailImapTransport implements ValidatorConstraintInterface {
  validate(port: unknown, args: ValidationArguments) {
    const security = (args.object as { security?: unknown }).security;
    return (
      (port === 993 && security === "TLS") ||
      (port === 143 && security === "STARTTLS")
    );
  }
}

@ValidatorConstraint({ name: "validMailSmtpTransport", async: false })
class ValidMailSmtpTransport implements ValidatorConstraintInterface {
  validate(port: unknown, args: ValidationArguments) {
    const security = (args.object as { security?: unknown }).security;
    return (
      (port === 465 && security === "TLS") ||
      ([25, 587, 2525].includes(port as number) && security === "STARTTLS")
    );
  }
}

export class MailQueryDto {
  @IsUUID("4") workspaceId!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2048) cursor?: string;
  @IsOptional() @IsUUID("4") mailboxId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class MailMessagesQuery extends MailQueryDto {
  @IsIn(["INBOX", "SENT"]) folder!: "INBOX" | "SENT";
}

export class MailMessageQuery extends MailQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["html"]) bodyFormat?: "html";
}

export class MailNotificationsQuery {
  @IsUUID("4") workspaceId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @Equals(10) pageSize = 10;
  @IsIn(["true", "false"]) unreadOnly = "false";
}

export class MailNotificationReadDto {
  @Equals(1) schemaVersion!: 1;
  @IsUUID("4") workspaceId!: string;
  @IsBoolean() read!: boolean;
}

export class MailCommandBaseDto {
  @Equals(1) schemaVersion!: 1;
  @IsUUID("4") workspaceId!: string;
  @IsUUID("4") commandId!: string;
}

export class MailImapTransportDto {
  @Validate(MailPublicDnsHostname) host!: string;
  @IsInt() @Validate(ValidMailImapTransport) port!: number;
  @IsIn(["TLS", "STARTTLS"]) security!: "TLS" | "STARTTLS";
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  @Matches(HEADER_TEXT)
  username!: string;
}

export class MailSmtpTransportDto {
  @Validate(MailPublicDnsHostname) host!: string;
  @IsInt() @Validate(ValidMailSmtpTransport) port!: number;
  @IsIn(["TLS", "STARTTLS"]) security!: "TLS" | "STARTTLS";
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  @Matches(HEADER_TEXT)
  username!: string;
}

export class MailConnectDto extends MailCommandBaseDto {
  @IsIn(["PERSONAL", "SHARED"]) kind!: "PERSONAL" | "SHARED";
  @IsEmail(ADDRESS_EMAIL) @MaxLength(254) address!: string;
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  @Matches(SAFE_LABEL)
  displayName!: string;
  @ValidateNested()
  @Type(() => MailImapTransportDto)
  imap!: MailImapTransportDto;
  @ValidateNested()
  @Type(() => MailSmtpTransportDto)
  smtp!: MailSmtpTransportDto;
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  @Matches(/^[^\r\n\x00]+$/)
  password!: string;
  @Validate(MailNullablePassword) smtpPassword!: string | null;
}

export class MailReconnectDto extends MailCommandBaseDto {
  @IsInt() @Min(1) @Max(2_147_483_646) expectedVersion!: number;
  @ValidateNested()
  @Type(() => MailImapTransportDto)
  imap!: MailImapTransportDto;
  @ValidateNested()
  @Type(() => MailSmtpTransportDto)
  smtp!: MailSmtpTransportDto;
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  @Matches(/^[^\r\n\x00]+$/)
  password!: string;
  @Validate(MailNullablePassword) smtpPassword!: string | null;
}

export class MailFolderSelectionDto {
  @IsString() @MinLength(1) @MaxLength(512) @Matches(HEADER_TEXT) path!: string;
  @IsIn(["INBOX", "SENT"]) kind!: "INBOX" | "SENT";
}

export class MailFoldersDto extends MailCommandBaseDto {
  @IsInt() @Min(1) @Max(2_147_483_646) expectedVersion!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique((folder: MailFolderSelectionDto) => folder.kind)
  @ArrayUnique((folder: MailFolderSelectionDto) => folder.path)
  @ValidateNested({ each: true })
  @Type(() => MailFolderSelectionDto)
  folders!: MailFolderSelectionDto[];
}

export class MailboxGrantDto {
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\s\x00-\x1f\x7f]+$/)
  subject!: string;
  @IsUUID("4") membershipId!: string;
  @IsBoolean() read!: boolean;
  @IsBoolean() @Validate(MailSendRequiresRead) send!: boolean;
  @IsBoolean() manage!: boolean;
}

export class MailGrantsDto extends MailCommandBaseDto {
  @IsInt() @Min(1) @Max(2_147_483_646) expectedVersion!: number;
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique(
    (grant: MailboxGrantDto) => `${grant.subject}:${grant.membershipId}`,
  )
  @ValidateNested({ each: true })
  @Type(() => MailboxGrantDto)
  grants!: MailboxGrantDto[];
}

export class MailDisconnectDto extends MailCommandBaseDto {
  @IsInt() @Min(1) @Max(2_147_483_646) expectedVersion!: number;
}

export class MailLinkDto extends MailCommandBaseDto {
  @IsInt() @Min(1) @Max(2_147_483_646) expectedVersion!: number;
  @IsEmail(ADDRESS_EMAIL) @MaxLength(254) externalEmail!: string;
  @IsUUID("4") contactId!: string;
}

export class MailPrepareAttachmentDto extends MailCommandBaseDto {
  @IsUUID("4") messageId!: string;
}

export class MailUploadDto {
  @Transform(({ value }) => (value === "1" ? 1 : value))
  @Equals(1)
  schemaVersion!: 1;
  @IsUUID("4") workspaceId!: string;
  @IsUUID("4") commandId!: string;
  @IsUUID("4") mailboxId!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID("4") contactId?: string;
}

export class MailAddressDto {
  @IsEmail(ADDRESS_EMAIL) @MaxLength(254) email!: string;
  @Validate(MailNullableName) name!: string | null;
}

export class MailSendDto extends MailCommandBaseDto {
  @IsUUID("4") mailboxId!: string;
  @Validate(MailNullableUuid) contactId!: string | null;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Validate(MailRecipientsWithinLimit)
  @ValidateNested({ each: true })
  @Type(() => MailAddressDto)
  to!: MailAddressDto[];
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MailAddressDto)
  cc!: MailAddressDto[];
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MailAddressDto)
  bcc!: MailAddressDto[];
  @IsString() @MaxLength(300) @Matches(HEADER_TEXT) subject!: string;
  @IsString() @Validate(MailUtf8TextWithinLimit) text!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString() @MaxLength(24576) html?: string;
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  attachmentIds!: string[];
  @Validate(MailNullableUuid) replyToMessageId!: string | null;
}
