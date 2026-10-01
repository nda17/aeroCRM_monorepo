import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  assertCustomersPermission,
  CustomersAuthorizationClient,
} from "../access/customers-authorization.client";
import {
  parseImportApply,
  parseImportGetQuery,
  parseImportInspect,
  parseImportPreview,
  parseImportResolve,
} from "./import.dto";
import { CustomerImportService } from "./import.service";

@Controller("crm/customers/imports")
export class CustomerImportController {
  constructor(
    private readonly authorization: CustomersAuthorizationClient,
    private readonly imports: CustomerImportService,
  ) {}
  @Post("inspect")
  @HttpCode(200)
  async inspect(
    @Headers("authorization") bearer: string | undefined,
    @Body() body: unknown,
  ) {
    const input = parseImportInspect(body);
    const result = this.imports.inspect(
      await this.authorization.authorize(bearer, input.workspaceId),
      input,
    );
    assertCustomersPermission(
      await this.authorization.authorize(bearer, input.workspaceId),
      "customers:read",
    );
    return result;
  }
  @Post("preview")
  @HttpCode(200)
  async preview(
    @Headers("authorization") bearer: string | undefined,
    @Body() body: unknown,
  ) {
    const input = parseImportPreview(body);
    const result = await this.imports.preview(
      await this.authorization.authorize(bearer, input.workspaceId),
      input,
    );
    const current = await this.authorization.authorize(
      bearer,
      input.workspaceId,
    );
    assertCustomersPermission(current, "customers:write", true);
    return this.imports.get(current, result.previewId, input.workspaceId);
  }
  @Get(":previewId")
  async get(
    @Headers("authorization") bearer: string | undefined,
    @Param("previewId", new ParseUUIDPipe({ version: "4" })) previewId: string,
    @Query() query: unknown,
  ) {
    const input = parseImportGetQuery(query);
    await this.imports.get(
      await this.authorization.authorize(bearer, input.workspaceId),
      previewId,
      input.workspaceId,
    );
    return this.imports.get(
      await this.authorization.authorize(bearer, input.workspaceId),
      previewId,
      input.workspaceId,
    );
  }
  @Post("apply")
  @HttpCode(200)
  async apply(
    @Headers("authorization") bearer: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    const input = parseImportApply(body);
    if (key !== input.commandId)
      throw new BadRequestException("Idempotency-Key must match commandId");
    await this.authorization.authorize(bearer, input.workspaceId);
    const result = await this.imports.apply(
      await this.authorization.authorize(bearer, input.workspaceId),
      input,
    );
    const current = await this.authorization.authorize(
      bearer,
      input.workspaceId,
    );
    assertCustomersPermission(current, "customers:write", true);
    await this.imports.get(current, result.previewId, input.workspaceId);
    return result;
  }
  @Post("resolve")
  @HttpCode(200)
  async resolve(
    @Headers("authorization") bearer: string | undefined,
    @Body() body: unknown,
  ) {
    const input = parseImportResolve(body);
    await this.imports.resolve(
      await this.authorization.authorize(bearer, input.workspaceId),
      input,
    );
    return this.imports.resolve(
      await this.authorization.authorize(bearer, input.workspaceId),
      input,
    );
  }
}
