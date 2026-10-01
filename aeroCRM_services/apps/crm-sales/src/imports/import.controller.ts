import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Header,
	Headers,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Req,
	UseGuards
} from '@nestjs/common';
import {
	SalesAccessGuard,
	SalesPermission,
	type SalesRequest
} from '../sales/sales-access';
import {
	parseImportApply,
	parseImportGetQuery,
	parseImportInspect,
	parseImportPreview
} from './import.dto';
import { SalesImportService } from './import.service';

@Controller('crm/sales/imports')
@UseGuards(SalesAccessGuard)
export class SalesImportController {
	constructor(private readonly imports: SalesImportService) {}

	@Post('inspect')
	@SalesPermission('sales:read')
	@Header('Cache-Control', 'no-store')
	inspect(@Req() request: SalesRequest, @Body() raw: unknown) {
		return this.imports.inspect(request.salesAccess, parseImportInspect(raw));
	}

	@Post('preview')
	@SalesPermission('sales:write')
	@Header('Cache-Control', 'no-store')
	preview(@Req() request: SalesRequest, @Body() raw: unknown) {
		return this.imports.preview(
			request.salesAccess,
			parseImportPreview(raw),
			request.headers.authorization!
		);
	}

	@Post('apply')
	@SalesPermission('sales:write')
	@Header('Cache-Control', 'no-store')
	apply(
		@Req() request: SalesRequest,
		@Body() raw: unknown,
		@Headers('idempotency-key') key: string | undefined
	) {
		const input = parseImportApply(raw);
		if (key !== input.commandId)
			throw new BadRequestException('Idempotency-Key должен совпадать с commandId');
		return this.imports.apply(
			request.salesAccess,
			input,
			request.headers.authorization!
		);
	}

	@Get(':previewId')
	@SalesPermission('sales:read')
	@Header('Cache-Control', 'no-store')
	get(
		@Req() request: SalesRequest,
		@Param('previewId', new ParseUUIDPipe({ version: '4' })) previewId: string,
		@Query() raw: unknown
	) {
		parseImportGetQuery(raw);
		return this.imports.get(
			request.salesAccess,
			previewId,
			request.headers.authorization!
		);
	}
}
