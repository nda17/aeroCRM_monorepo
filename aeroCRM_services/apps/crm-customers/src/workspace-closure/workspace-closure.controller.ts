import {
	ArgumentsHost,
	BadRequestException,
	CanActivate,
	Catch,
	ConflictException,
	Controller,
	ExecutionContext,
	ForbiddenException,
	Header,
	HttpCode,
	Injectable,
	Post,
	Body,
	UseGuards
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CrmCustomersPrismaService } from '../prisma/crm-customers-prisma.service';

@Injectable()
export class WorkspaceClosureInternalGuard implements CanActivate {
	private readonly token: Buffer;
	constructor(config: ConfigService) {
		const value =
			config.get<string>('CRM_CUSTOMERS_CRM_ACCESS_TOKEN')?.trim() || '';
		if (
			value.length < 32 ||
			value.length > 4096 ||
			/\s|change[_-]?me|replace-|<[^>]+>|^ci_/i.test(value)
		)
			throw new Error(
				'CRM_CUSTOMERS_CRM_ACCESS_TOKEN requires a distinct non-placeholder secret'
			);
		this.token = Buffer.from(value);
	}
	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<Request>();
		const remote = request.socket.remoteAddress?.toLowerCase() || '';
		const address = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
		const supplied = Buffer.from(
			request.header('x-aerocrm-internal-token') || ''
		);
		if (
			request.header('x-aerocrm-service') !== 'crm-access' ||
			!(address === '::1' || /^127(?:\.\d{1,3}){3}$/.test(address)) ||
			supplied.length !== this.token.length ||
			!timingSafeEqual(supplied, this.token)
		)
			throw new ForbiddenException('Invalid internal credentials');
		return true;
	}
}

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface ClosureEnvelope {
	schemaVersion: 1;
	closureId: string;
	workspaceId: string;
	generation: '1';
	ownerSubject: string;
	requestedAt: string;
}
function envelope(value: unknown, settlement = false): ClosureEnvelope {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new BadRequestException('Invalid closure envelope');
	const v = value as Record<string, unknown>;
	const keys = settlement
		? 'closureId,customersFencedAt,generation,ownerSubject,requestedAt,salesFencedAt,schemaVersion,workspaceId'
		: 'closureId,generation,ownerSubject,requestedAt,schemaVersion,workspaceId';
	if (
		Object.keys(v).sort().join(',') !== keys ||
		v.schemaVersion !== 1 ||
		v.generation !== '1' ||
		!UUID.test(String(v.closureId)) ||
		!UUID.test(String(v.workspaceId)) ||
		typeof v.ownerSubject !== 'string' ||
		!v.ownerSubject.trim() ||
		v.ownerSubject.length > 256 ||
		typeof v.requestedAt !== 'string' ||
		!Number.isFinite(Date.parse(v.requestedAt)) ||
		new Date(v.requestedAt).toISOString() !== v.requestedAt ||
		(settlement &&
			['customersFencedAt', 'salesFencedAt'].some(
				k =>
					typeof v[k] !== 'string' ||
					!Number.isFinite(Date.parse(String(v[k]))) ||
					new Date(String(v[k])).toISOString() !== v[k]
			))
	)
		throw new BadRequestException('Invalid closure envelope');
	return v as unknown as ClosureEnvelope;
}

@Injectable()
export class WorkspaceClosureService {
	constructor(private readonly prisma: CrmCustomersPrismaService) {}
	async fence(binding: ClosureEnvelope) {
		const fencedAt = await this.prisma.$transaction(async tx => {
			await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
			const rows = await tx.$queryRaw<Array<{ fenced_at: Date }>>`
        INSERT INTO crm_customers.workspace_closure_fences (workspace_id, closure_id, generation, owner_subject, requested_at, fenced_at)
        VALUES (${binding.workspaceId}::uuid, ${binding.closureId}::uuid, 1, ${binding.ownerSubject}, ${binding.requestedAt}::timestamptz, clock_timestamp())
        ON CONFLICT (workspace_id) DO UPDATE SET
          closure_id = EXCLUDED.closure_id, generation = EXCLUDED.generation,
          owner_subject = EXCLUDED.owner_subject, requested_at = EXCLUDED.requested_at,
          fenced_at = EXCLUDED.fenced_at, revision = workspace_closure_fences.revision + 1
        WHERE workspace_closure_fences.fenced_at IS NULL
        RETURNING fenced_at`;
			if (rows.length) {
				return rows[0].fenced_at;
			}
			const current = await tx.workspaceClosureFence.findUnique({
				where: { workspaceId: binding.workspaceId }
			});
			if (
				!current ||
				current.closureId !== binding.closureId ||
				current.generation !== 1n ||
				current.ownerSubject !== binding.ownerSubject ||
				current.requestedAt?.toISOString() !== binding.requestedAt ||
				!current.fencedAt
			)
				throw new ConflictException({ code: 'crm_workspace_closure_binding_conflict', message: 'Workspace closure binding differs' });
			return current.fencedAt;
		});
		return {
			schemaVersion: 1,
			service: 'crm-customers',
			closureId: binding.closureId,
			workspaceId: binding.workspaceId,
			generation: '1',
			state: 'FENCED',
			fencedAt: fencedAt.toISOString(),
			financialPendingCount: 0,
			priorDispatchCount: 0
		};
	}
}

@Controller('internal/v1/workspace-closures')
@UseGuards(WorkspaceClosureInternalGuard)
export class WorkspaceClosureController {
	constructor(private readonly closures: WorkspaceClosureService) {}
	@Post('fence')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	fence(@Body() body: unknown) {
		return this.closures.fence(envelope(body));
	}
}

@Catch()
export class WorkspaceClosureErrorFilter extends BaseExceptionFilter {
	constructor(adapter: HttpAdapterHost) {
		super(adapter.httpAdapter);
	}
	catch(error: unknown, host: ArgumentsHost) {
		if (
			error instanceof Error &&
			String(error).includes('crm_workspace_closed')
		)
			return super.catch(
				new ForbiddenException({
					code: 'crm_workspace_closed',
					message: 'Workspace is closed'
				}),
				host
			);
		return super.catch(error, host);
	}
}
