import { BadRequestException, Controller, Get, Header, Headers, HttpCode, Param,
	ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Query, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { BillingCommerceClient } from '../billing/billing-commerce.client';
import type { CrmCommerceSummary, CrmHistoryResponse, CrmOrderResponse } from '../billing/billing.contract';
import { parseClosureCommand } from './workspace-closure.contract';
import { WorkspaceClosureService } from './workspace-closure.service';

@Controller('crm/access')
export class WorkspaceClosureController {
	constructor(private readonly closure: WorkspaceClosureService,
		private readonly billing: BillingCommerceClient) {}

	@Get('workspace-closures/:id/billing')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	async billingSummary(@Headers('authorization') authorization: string | undefined,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
		const owner = await this.closure.requireClosedOwner(authorization, id);
		const billing = await this.billing.request<CrmCommerceSummary>('summary',
			{ schemaVersion: 1, ...owner }, 'summary');
		await this.closure.requireClosedOwner(authorization, id);
		return { schemaVersion: 1 as const, ...owner, billing };
	}

	@Get('workspace-closures/:id/billing/history')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	async billingHistory(@Headers('authorization') authorization: string | undefined,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Query('page') rawPage?: string, @Query('pageSize') rawPageSize?: string) {
		const page = rawPage === undefined ? 1 : Number(rawPage);
		const pageSize = rawPageSize === undefined ? 20 : Number(rawPageSize);
		if (!Number.isInteger(page) || page < 1 || page > 100000 ||
			!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
			throw new BadRequestException('Invalid billing history page');
		const owner = await this.closure.requireClosedOwner(authorization, id);
		const history = await this.billing.request<CrmHistoryResponse>('history',
			{ schemaVersion: 1, ...owner, page, pageSize }, 'history');
		if (history.page !== page || history.pageSize !== pageSize)
			throw new ServiceUnavailableException('CRM billing history binding is invalid');
		await this.closure.requireClosedOwner(authorization, id);
		return history;
	}

	@Get('workspace-closures/:id/billing/orders/:orderId')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	async billingOrder(@Headers('authorization') authorization: string | undefined,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
		@Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string) {
		const owner = await this.closure.requireClosedOwner(authorization, id);
		const order = await this.billing.request<CrmOrderResponse>('orders/get',
			{ schemaVersion: 1, ...owner, orderId }, 'order');
		if (order.order.id !== orderId) throw new ServiceUnavailableException('CRM billing order binding is invalid');
		await this.closure.requireClosedOwner(authorization, id);
		return order;
	}

	@Get('workspaces/:workspaceId/closure-preview')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	preview(@Headers('authorization') authorization: string | undefined,
		@Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string) {
		return this.closure.preview(authorization, workspaceId);
	}

	@Post('workspace-closures')
	@HttpCode(202)
	@Header('Cache-Control', 'no-store')
	create(@Headers('authorization') authorization: string | undefined,
		@Headers('idempotency-key') key: string | undefined,
		@Req() request: Request) {
		const command = parseClosureCommand(request.body);
		if (!command || key !== command.commandId)
			throw new BadRequestException('Invalid workspace closure command');
		return this.closure.create(authorization, command);
	}

	@Get('workspace-closures')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	list(@Headers('authorization') authorization: string | undefined) {
		return this.closure.list(authorization);
	}

	@Get('workspace-closures/:id')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	get(@Headers('authorization') authorization: string | undefined,
		@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
		return this.closure.get(authorization, id);
	}
}
