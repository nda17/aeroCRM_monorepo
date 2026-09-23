import { BadRequestException, Body, Controller, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { BillingCrmAccessGuard } from '../auth/billing-crm-access.guard';
import { BillingWorkspaceClosureService, type BillingClosureEnvelope } from '../domain/workspace-closure.service';

@Controller('internal/v1/workspace-closures')
@UseGuards(BillingCrmAccessGuard)
export class BillingWorkspaceClosureController {
	constructor(private readonly closure: BillingWorkspaceClosureService) {}

	@Post('fence')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	fence(@Body() body: unknown) {
		return this.closure.fence(this.parse(body));
	}

	private parse(body: unknown): BillingClosureEnvelope {
		if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid closure envelope');
		const row = body as Record<string, unknown>;
		const uuid = (value: unknown) => typeof value === 'string' &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
		if (Object.keys(row).sort().join(',') !== 'closureId,generation,ownerSubject,requestedAt,schemaVersion,workspaceId' ||
			row.schemaVersion !== 1 || row.generation !== '1' || !uuid(row.closureId) || !uuid(row.workspaceId) ||
			typeof row.ownerSubject !== 'string' || row.ownerSubject.length < 1 || row.ownerSubject.length > 256 ||
			/[\s\x00-\x1f\x7f]/.test(row.ownerSubject) || typeof row.requestedAt !== 'string' ||
			!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.requestedAt) ||
			!Number.isFinite(Date.parse(row.requestedAt))) throw new BadRequestException('Invalid closure envelope');
		return row as unknown as BillingClosureEnvelope;
	}
}
