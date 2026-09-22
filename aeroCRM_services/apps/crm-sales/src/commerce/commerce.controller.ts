import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Headers,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Req,
	Res,
	UseGuards
} from '@nestjs/common';
import type { Response } from 'express';
import {
	SalesAccessGuard,
	SalesPermission,
	type SalesRequest
} from '../sales/sales-access';
import { CommerceService } from './commerce.service';
import { CommerceFinanceService } from './commerce-finance.service';
import { CommerceImportService } from './commerce-import.service';
import {
	AddPaymentDto,
	AddStageDto,
	CatalogArchiveDto,
	CatalogCreateDto,
	CatalogUpdateDto,
	CommerceExportQuery,
	CommerceHistoryQuery,
	CommerceListQuery,
	CommercePeriodQuery,
	CommerceWorkspaceQuery,
	CreatePipelineDto,
	CreateQuoteDto,
	CorrectPaymentDto,
	ImportApplyDto,
	ImportInspectDto,
	ImportPreviewDto,
	RenamePipelineDto,
	RenameStageDto,
	ReplaceDealLinesDto,
	ReorderStagesDto,
	SaveLineToCatalogDto
} from './commerce.dto';

@Controller('crm/sales/commerce')
@UseGuards(SalesAccessGuard)
export class CommerceController {
	constructor(
		private readonly commerce: CommerceService,
		private readonly finance: CommerceFinanceService,
		private readonly imports: CommerceImportService
	) {}
	private key(body: unknown, key: unknown) {
		if (
			!body ||
			typeof body !== 'object' ||
			Array.isArray(body) ||
			!('commandId' in body) ||
			body.commandId !== key
		)
			throw new BadRequestException(
				'Idempotency-Key должен совпадать с commandId'
			);
	}
	@Get('pipelines') @SalesPermission('sales:read') pipelines(
		@Req() req: SalesRequest,
		@Query() query: CommerceWorkspaceQuery
	) {
		void query;
		return this.commerce.pipelines(req.salesAccess);
	}
	@Get('analytics/pipelines')
	@SalesPermission('sales:analytics')
	analyticsPipelines(
		@Req() req: SalesRequest,
		@Query() query: CommerceWorkspaceQuery
	) {
		void query;
		return this.commerce.analyticsPipelines(req.salesAccess);
	}
	@Post('pipelines') @SalesPermission('sales:manage-pipelines') createPipeline(
		@Req() req: SalesRequest,
		@Body() body: CreatePipelineDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.createPipeline(req.salesAccess, body);
	}
	@Post('pipelines/:id/rename')
	@SalesPermission('sales:manage-pipelines')
	renamePipeline(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() body: RenamePipelineDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.renamePipeline(req.salesAccess, id, body);
	}
	@Post('pipelines/:id/stages')
	@SalesPermission('sales:manage-pipelines')
	addStage(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() body: AddStageDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.addStage(req.salesAccess, id, body);
	}
	@Post('pipelines/:id/stages/:stageId/rename')
	@SalesPermission('sales:manage-pipelines')
	renameStage(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Param('stageId', new ParseUUIDPipe({ version: '4' })) stageId: string,
		@Body() body: RenameStageDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.renameStage(req.salesAccess, id, stageId, body);
	}
	@Post('pipelines/:id/reorder')
	@SalesPermission('sales:manage-pipelines')
	reorder(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() body: ReorderStagesDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.reorderStages(req.salesAccess, id, body);
	}
	@Get('catalog') @SalesPermission('sales:read') catalog(
		@Req() req: SalesRequest,
		@Query() query: CommerceListQuery
	) {
		return this.commerce.catalog(
			req.salesAccess,
			query as unknown as Record<string, unknown>
		);
	}
	@Post('catalog') @SalesPermission('sales:write') createCatalog(
		@Req() req: SalesRequest,
		@Body() body: CatalogCreateDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.createCatalog(req.salesAccess, body);
	}
	@Post('catalog/:id/update') @SalesPermission('sales:write') updateCatalog(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() body: CatalogUpdateDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.updateCatalog(req.salesAccess, id, body);
	}
	@Post('catalog/:id/archive') @SalesPermission('sales:write') archiveCatalog(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() body: CatalogArchiveDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.updateCatalog(req.salesAccess, id, body, true);
	}
	@Get('deals/:id/lines') @SalesPermission('sales:read') lines(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Query() query: CommerceWorkspaceQuery
	) {
		void query;
		return this.commerce.lines(req.salesAccess, id);
	}
	@Post('deals/:id/lines/replace') @SalesPermission('sales:write') replaceLines(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() body: ReplaceDealLinesDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.replaceLines(req.salesAccess, id, body);
	}
	@Post('deals/:id/lines/:lineId/save-to-catalog')
	@SalesPermission('sales:write')
	saveLine(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Param('lineId', new ParseUUIDPipe({ version: '4' })) lineId: string,
		@Body() body: SaveLineToCatalogDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.commerce.saveLine(req.salesAccess, id, lineId, body);
	}
	@Get('deals/:id/payments') @SalesPermission('sales:read') payments(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Query() query: CommerceWorkspaceQuery
	) {
		void query;
		return this.finance.payments(req.salesAccess, id);
	}
	@Post('deals/:id/payments') @SalesPermission('sales:write') addPayment(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() body: AddPaymentDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.finance.addPayment(req.salesAccess, id, body);
	}
	@Post('deals/:id/payments/:paymentId/correct')
	@SalesPermission('sales:write')
	correctPayment(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Param('paymentId', new ParseUUIDPipe({ version: '4' })) paymentId: string,
		@Body() body: CorrectPaymentDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.finance.correctPayment(req.salesAccess, id, paymentId, body);
	}
	@Get('deals/:id/quotes') @SalesPermission('sales:read') quotes(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Query() query: CommerceWorkspaceQuery
	) {
		void query;
		return this.finance.quotes(req.salesAccess, id);
	}
	@Post('deals/:id/quotes') @SalesPermission('sales:write') createQuote(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Body() body: CreateQuoteDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.finance.createQuote(req.salesAccess, id, body);
	}
	@Get('deals/:id/quotes/:quoteId/download')
	@SalesPermission('sales:read')
	async quoteDownload(
		@Req() req: SalesRequest,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Param('quoteId', new ParseUUIDPipe({ version: '4' })) quoteId: string,
		@Query() query: CommerceWorkspaceQuery,
		@Res() res: Response
	) {
		void query;
		const html = await this.finance.quoteHtml(req.salesAccess, id, quoteId);
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="aerocrm-quote-${quoteId}.html"`
		);
		res.setHeader('Cache-Control', 'no-store');
		res.send(html);
	}
	@Get('analytics') @SalesPermission('sales:analytics') analytics(
		@Req() req: SalesRequest,
		@Query() query: CommercePeriodQuery
	) {
		return this.finance.analytics(
			req.salesAccess,
			query as unknown as Record<string, unknown>
		);
	}
	@Get('history') @SalesPermission('sales:read') history(
		@Req() req: SalesRequest,
		@Query() query: CommerceHistoryQuery
	) {
		return this.finance.history(
			req.salesAccess,
			query as unknown as Record<string, unknown>
		);
	}
	@Get('export') @SalesPermission('sales:export') async exportDetail(
		@Req() req: SalesRequest,
		@Query() query: CommerceExportQuery,
		@Res() res: Response
	) {
		const file = await this.finance.exportDetail(req.salesAccess, query.format);
		res.setHeader('Content-Type', file.contentType);
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="${file.filename}"`
		);
		res.setHeader('Cache-Control', 'no-store');
		res.send(file.body);
	}
	@Post('import/inspect') @SalesPermission('sales:read') inspect(
		@Req() req: SalesRequest,
		@Body() body: ImportInspectDto
	) {
		return this.imports.inspect(req.salesAccess, body);
	}
	@Post('import/preview') @SalesPermission('sales:write') preview(
		@Req() req: SalesRequest,
		@Body() body: ImportPreviewDto
	) {
		return this.imports.preview(req.salesAccess, body);
	}
	@Post('import/apply') @SalesPermission('sales:write') apply(
		@Req() req: SalesRequest,
		@Body() body: ImportApplyDto,
		@Headers('idempotency-key') key: string
	) {
		this.key(body, key);
		return this.imports.apply(req.salesAccess, body);
	}
}
