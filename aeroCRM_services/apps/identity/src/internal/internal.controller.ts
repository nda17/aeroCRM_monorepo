import {
	Body,
	BadRequestException,
	Controller,
	Get,
	Headers,
	Header,
	HttpCode,
	Post,
	Req,
	Res,
	UseGuards,
	UsePipes,
	ValidationPipe
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
	ArrayMaxSize,
	ArrayNotEmpty,
	Equals,
	IsArray,
	IsIn,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	MaxLength
} from 'class-validator';
import { LifecycleCompleteDto } from '../auth/auth.dto';
import { IdentityInternalGuard, InternalServices } from './internal.guard';
import { IdentityInternalService } from './internal.service';
import { IdentityProviderHealthService } from '../health/identity-provider-health.service';

export class CampaignContactsDto {
	@Equals(1)
	schemaVersion!: 1;

	@IsIn(['EMAIL', 'TELEGRAM'])
	channel!: 'EMAIL' | 'TELEGRAM';
}

export class AuditSnapshotsDto {
	@IsArray()
	@ArrayNotEmpty()
	@ArrayMaxSize(100)
	@IsString({ each: true })
	@MaxLength(255, { each: true })
	userIds!: string[];
}

export class CrmSourceContextDto {
	@Equals(1)
	schemaVersion!: 1;

	@IsUUID('4')
	workspaceId!: string;

	@IsString()
	@MaxLength(256)
	@Matches(/^[^\s\x00-\x1f\x7f]{1,256}$/)
	subject!: string;
}

export class SupportAuthorContextDto {
	@Equals(1) schemaVersion!: 1;
	@IsOptional() @IsUUID('4') workspaceId?: string;
}

export class SupportRecipientContextDto {
	@Equals(1) schemaVersion!: 1;
	@IsString()
	@MaxLength(256)
	@Matches(/^[^\s\x00-\x1f\x7f]{1,256}$/)
	subject!: string;
}

@Controller('internal/v1')
@UseGuards(IdentityInternalGuard)
@UsePipes(
	new ValidationPipe({
		whitelist: true,
		forbidNonWhitelisted: true,
		transform: true
	})
)
export class IdentityInternalController {
	constructor(
		private readonly internal: IdentityInternalService,
		private readonly providerHealth: IdentityProviderHealthService
	) {}

	@Post('auth/introspect')
	@HttpCode(200)
	@InternalServices(
		'campaigns',
		'reporting',
		'billing',
		'platform',
		'support',
		'operations'
	)
	introspect(@Headers('authorization') authorization?: string) {
		return this.internal.introspect(authorization);
	}

	@Post('support/author-context')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@InternalServices('support')
	supportAuthorContext(
		@Headers('authorization') authorization: string | undefined,
		@Body() dto: SupportAuthorContextDto,
		@Req() request: Request
	) {
		this.exactSupportBody(request.body, ['schemaVersion', 'workspaceId']);
		return this.internal.supportAuthorContext(
			authorization,
			dto.workspaceId
		);
	}

	@Post('support/recipient-context')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@InternalServices('support')
	supportRecipientContext(
		@Body() dto: SupportRecipientContextDto,
		@Req() request: Request
	) {
		this.exactSupportBody(request.body, ['schemaVersion', 'subject']);
		return this.internal.supportRecipientContext(dto.subject);
	}

	private exactSupportBody(value: unknown, allowed: string[]): void {
		if (
			!value ||
			typeof value !== 'object' ||
			Array.isArray(value) ||
			Object.keys(value).some(key => !allowed.includes(key))
		) {
			throw new BadRequestException('Invalid support context');
		}
	}

	@Post('crm-access/auth-context')
	@HttpCode(200)
	@InternalServices('crm-access')
	crmAccessAuthContext(@Headers('authorization') authorization?: string) {
		return this.internal.crmAccessAuthContext(authorization);
	}

	@Post('crm-access/source-context')
	@HttpCode(200)
	@InternalServices('crm-access')
	crmSourceContext(@Body() dto: CrmSourceContextDto) {
		return this.internal.crmSourceContext(dto.workspaceId, dto.subject);
	}

	@Post('crm-access/owner-context')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@InternalServices('crm-access')
	crmOwnerContext(
		@Body() dto: CrmSourceContextDto,
		@Req() request: Request
	) {
		// The existing global whitelist strips extra DTO fields before local pipes.
		// Check this new exact contract against the original body, without changing old routes.
		const raw: unknown = request.body;
		if (
			!raw ||
			typeof raw !== 'object' ||
			Array.isArray(raw) ||
			Object.keys(raw).length !== 3 ||
			!['schemaVersion', 'workspaceId', 'subject'].every(key =>
				Object.hasOwn(raw, key)
			)
		)
			throw new BadRequestException('Invalid CRM owner context');
		return this.internal.crmOwnerContext(
			dto.workspaceId,
			dto.subject
		);
	}

	@Post('crm-access/closure-owner-context')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@InternalServices('crm-access')
	closureOwnerContext(@Body() body: unknown) {
		return this.internal.closureOwnerContext(this.closureOwnerBody(body));
	}

	@Post('workspace-closures/fence')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@InternalServices('crm-access')
	closureFence(@Body() body: unknown) {
		return this.internal.fenceWorkspace(this.closureFenceBody(body));
	}

	private closureOwnerBody(value: unknown) {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new BadRequestException('Invalid closure owner context');
		const row = value as Record<string, unknown>;
		if (Object.keys(row).sort().join(',') !== 'closureId,schemaVersion,subject,workspaceId' ||
			row.schemaVersion !== 1 || !this.uuid(row.workspaceId) || !this.uuid(row.closureId) ||
			!this.subject(row.subject)) throw new BadRequestException('Invalid closure owner context');
		return row as { schemaVersion: 1; workspaceId: string; closureId: string; subject: string };
	}

	private closureFenceBody(value: unknown) {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new BadRequestException('Invalid closure envelope');
		const row = value as Record<string, unknown>;
		if (Object.keys(row).sort().join(',') !== 'closureId,generation,ownerSubject,requestedAt,schemaVersion,workspaceId' ||
			row.schemaVersion !== 1 || row.generation !== '1' ||
			!this.uuid(row.workspaceId) || !this.uuid(row.closureId) ||
			!this.subject(row.ownerSubject) || typeof row.requestedAt !== 'string' ||
			!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.requestedAt) ||
			!Number.isFinite(Date.parse(row.requestedAt))) throw new BadRequestException('Invalid closure envelope');
		return row as { schemaVersion: 1; workspaceId: string; closureId: string; generation: '1'; ownerSubject: string; requestedAt: string };
	}

	private uuid(value: unknown): value is string {
		return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
	}

	private subject(value: unknown): value is string {
		return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
			/^[^\s\x00-\x1f\x7f\uD800-\uDFFF\uFFFD]+$/u.test(value);
	}

	@Post('operations/audit-snapshots')
	@HttpCode(200)
	@InternalServices('operations')
	auditSnapshots(@Body() dto: AuditSnapshotsDto) {
		return this.internal.auditSnapshots(dto.userIds);
	}

	@Get('operations/admin-health')
	@HttpCode(200)
	@InternalServices('operations')
	adminHealth() {
		return this.providerHealth.providerHealth();
	}

	@Post('campaigns/eligible-contacts')
	@HttpCode(200)
	@InternalServices('campaigns')
	async campaignContacts(
		@Body() body: CampaignContactsDto,
		@Req() request: Request,
		@Res() response: Response
	): Promise<void> {
		if (
			!body ||
			body.schemaVersion !== 1 ||
			!['EMAIL', 'TELEGRAM'].includes(body.channel)
		) {
			throw new Error('Invalid campaign contact export request');
		}
		response.status(200);
		response.setHeader(
			'Content-Type',
			'application/x-ndjson; charset=utf-8'
		);
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('X-Accel-Buffering', 'no');
		try {
			await this.internal.streamCampaignContacts(
				body.channel,
				request,
				response
			);
			response.end();
		} catch (error) {
			if (!response.headersSent) throw error;
			response.destroy(
				error instanceof Error
					? error
					: new Error('Campaign contact export failed')
			);
		}
	}

	@Post('billing/lifecycle/complete')
	@HttpCode(200)
	@InternalServices('billing')
	completeLifecycle(
		@Body() dto: LifecycleCompleteDto,
		@Req() request: Request
	) {
		return this.internal.completeLifecycle(dto, request);
	}
}
