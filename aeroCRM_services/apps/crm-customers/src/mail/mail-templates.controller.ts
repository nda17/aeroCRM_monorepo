import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
  Query,
} from "@nestjs/common";
import { MailAuthorizationClient } from "./mail-authorization.client";
import { MailQueryDto } from "./mail.dto";
import { SaveMailTemplatesDto } from "./mail-templates.dto";
import { MailTemplatesService } from "./mail-templates.service";

@Controller("crm/customers/mail/templates")
export class MailTemplatesController {
  constructor(
    private readonly authorization: MailAuthorizationClient,
    private readonly service: MailTemplatesService,
  ) {}

  @Get()
  @Header("Cache-Control", "private,no-store")
  async settings(
    @Headers("authorization") token: string | undefined,
    @Query() query: MailQueryDto,
  ) {
    return this.service.settings(
      await this.authorization.authorize(token, query.workspaceId),
      query.workspaceId,
    );
  }

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "private,no-store")
  async save(
    @Headers("authorization") token: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: SaveMailTemplatesDto,
  ) {
    if (key !== dto.commandId)
      throw new BadRequestException({
        code: "crm_mail_idempotency_key_required",
      });
    const authority = await this.authorization.authorize(
      token,
      dto.workspaceId,
    );
    return this.service.save(authority, dto, token!);
  }
}
