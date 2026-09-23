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
import { CrmIntakePrismaService } from '../prisma/crm-intake-prisma.service';
import { Prisma } from '@prisma/crm-intake-client';
import { randomUUID } from 'node:crypto';
import {
	AcceptanceOperationsClient,
	parseOperationProof
} from '../acceptance/acceptance-operations.client';
import { acceptanceBinding } from '../acceptance/acceptance.service';

@Injectable()
export class WorkspaceClosureInternalGuard implements CanActivate {
	private readonly token: Buffer;
	constructor(config: ConfigService) {
		const value =
			config.get<string>('CRM_INTAKE_CRM_ACCESS_TOKEN')?.trim() || '';
		if (
			value.length < 32 ||
			value.length > 4096 ||
			/\s|change[_-]?me|replace-|<[^>]+>|^ci_/i.test(value)
		)
			throw new Error(
				'CRM_INTAKE_CRM_ACCESS_TOKEN requires a distinct non-placeholder secret'
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
	constructor(
		private readonly prisma: CrmIntakePrismaService,
		private readonly operations: AcceptanceOperationsClient
	) {}
	async fence(binding: ClosureEnvelope) {
		const fencedAt = await this.prisma.$transaction(async tx => {
			await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
			await tx.$executeRaw`INSERT INTO crm_intake.workspace_closure_fences (workspace_id)
        VALUES (${binding.workspaceId}::uuid) ON CONFLICT (workspace_id) DO NOTHING`;
			const rows = await tx.$queryRaw<
				Array<{
					closure_id: string | null;
					generation: bigint | null;
					owner_subject: string | null;
					requested_at: Date | null;
					fenced_at: Date | null;
				}>
			>`
        SELECT closure_id, generation, owner_subject, requested_at, fenced_at
        FROM crm_intake.workspace_closure_fences WHERE workspace_id=${binding.workspaceId}::uuid FOR UPDATE`;
			const current = rows[0];
			if (!current)
				throw new ConflictException('Workspace closure fence is unavailable');
			if (current.fenced_at) {
				if (
					current.closure_id !== binding.closureId ||
					current.generation !== 1n ||
					current.owner_subject !== binding.ownerSubject ||
					current.requested_at?.toISOString() !== binding.requestedAt
				)
					throw new ConflictException({ code: 'crm_workspace_closure_binding_conflict', message: 'Workspace closure binding differs' });
				return current.fenced_at;
			}
			await tx.acceptance.updateMany({
				where: {
					workspaceId: binding.workspaceId,
					status: { notIn: ['COMPLETED', 'CANCELLED'] }
				},
				data: {
					generation: { increment: 1 },
					version: { increment: 1 },
					retryAt: null
				}
			});
			await tx.acceptanceReceipt.updateMany({
				where: { workspaceId: binding.workspaceId, status: 'PROCESSING' },
				data: { status: 'DELIVERED', leaseToken: null, leaseUntil: null }
			});
			const closed = await tx.$queryRaw<Array<{ fenced_at: Date }>>`
        UPDATE crm_intake.workspace_closure_fences SET closure_id=${binding.closureId}::uuid,
          generation=1, owner_subject=${binding.ownerSubject}, requested_at=${binding.requestedAt}::timestamptz,
          fenced_at=clock_timestamp(), revision=revision+1
        WHERE workspace_id=${binding.workspaceId}::uuid AND fenced_at IS NULL RETURNING fenced_at`;
			if (closed.length !== 1)
				throw new ConflictException('Workspace closure fence changed');
			return closed[0].fenced_at;
		});
		return {
			schemaVersion: 1,
			service: 'crm-intake',
			closureId: binding.closureId,
			workspaceId: binding.workspaceId,
			generation: '1',
			state: 'FENCED',
			fencedAt: fencedAt.toISOString(),
			financialPendingCount: 0,
			priorDispatchCount: 0
		};
	}

	async settle(binding: ClosureEnvelope) {
		await this.assertFence(binding);
		const pending = await this.prisma.acceptance.findMany({
			where: {
				workspaceId: binding.workspaceId,
				status: { notIn: ['COMPLETED', 'CANCELLED'] }
			},
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			take: 20
		});
		for (const candidate of pending) {
			const sales = parseOperationProof(
				await this.operations.request(
					'sales',
					'read',
					acceptanceBinding(candidate, 'sales')
				),
				acceptanceBinding(candidate, 'sales'),
				'sales'
			);
			const contact = parseOperationProof(
				await this.operations.request(
					'customers',
					'read',
					acceptanceBinding(candidate, 'customers')
				),
				acceptanceBinding(candidate, 'customers'),
				'customers'
			);
			if (
				sales.state === 'COMMITTED' &&
				(contact.state !== 'COMMITTED' ||
					sales.result!.contactId !== contact.result!.contactId)
			)
				throw new ConflictException({ code: 'crm_workspace_closure_proof_conflict', message: 'Committed acceptance proofs do not match' });
			await this.prisma.$transaction(async tx => {
				await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
				await tx.$queryRaw`SELECT id FROM crm_intake.inbox_entries WHERE id=${candidate.entryId}::uuid AND workspace_id=${binding.workspaceId}::uuid FOR UPDATE`;
				const fence = await tx.workspaceClosureFence.findUnique({
					where: { workspaceId: binding.workspaceId }
				});
				if (
					!fence ||
					fence.closureId !== binding.closureId ||
					fence.generation !== 1n ||
					!fence.fencedAt
				)
					throw new ConflictException({ code: 'crm_workspace_closure_binding_conflict', message: 'Workspace closure binding differs' });
				const current = await tx.acceptance.findUnique({
					where: { id: candidate.id }
				});
				if (!current || ['COMPLETED', 'CANCELLED'].includes(current.status))
					return;
				if (
					current.generation !== candidate.generation ||
					current.version !== candidate.version
				)
					throw new ConflictException(
						'Acceptance changed during closure settlement'
					);
				const c = parseOperationProof(
					contact,
					acceptanceBinding(current, 'customers'),
					'customers'
				);
				const s = parseOperationProof(
					sales,
					acceptanceBinding(current, 'sales'),
					'sales'
				);
				const now = new Date();
				if (s.state === 'COMMITTED') {
					if (
						c.state !== 'COMMITTED' ||
						s.result!.contactId !== c.result!.contactId
					)
						throw new ConflictException(
							'Committed acceptance proofs do not match'
						);
					const changed = await tx.acceptance.updateMany({
						where: {
							id: current.id,
							generation: current.generation,
							version: current.version
						},
						data: {
							status: 'COMPLETED',
							contactProof: c as unknown as Prisma.InputJsonObject,
							salesProof: s as unknown as Prisma.InputJsonObject,
							contactId: String(c.result!.contactId),
							dealId: String(s.result!.dealId),
							firstTaskId: String(s.result!.firstTaskId),
							completedAt: now,
							lastErrorCode: null,
							retryAt: null,
							version: { increment: 1 }
						}
					});
					if (changed.count !== 1)
						throw new ConflictException(
							'Acceptance changed during closure settlement'
						);
					const entry = await tx.inboxEntry.updateMany({
						where: {
							id: current.entryId,
							workspaceId: current.workspaceId,
							status: 'NEW'
						},
						data: {
							status: 'ACCEPTED',
							contactId: String(c.result!.contactId),
							dealId: String(s.result!.dealId),
							acceptedAt: now,
							version: { increment: 1 }
						}
					});
					if (entry.count !== 1)
						throw new ConflictException({ code: 'crm_workspace_closure_entry_conflict', message: 'Inbox outcome changed' });
				} else {
					const changed = await tx.acceptance.updateMany({
						where: {
							id: current.id,
							generation: current.generation,
							version: current.version
						},
						data: {
							status: 'CANCELLED',
							contactProof: c as unknown as Prisma.InputJsonObject,
							salesProof: s as unknown as Prisma.InputJsonObject,
							contactId:
								c.state === 'COMMITTED' ? String(c.result!.contactId) : null,
							dealId: null,
							firstTaskId: null,
							completedAt: now,
							lastErrorCode: 'WORKSPACE_CLOSED',
							retryAt: null,
							version: { increment: 1 }
						}
					});
					if (changed.count !== 1)
						throw new ConflictException(
							'Acceptance changed during closure settlement'
						);
				}
				await tx.intakeActivity.create({
					data: {
						workspaceId: current.workspaceId,
						entityId: current.entryId,
						entityKind: 'entry',
						commandId: randomUUID(),
						actorSubject: current.actorSubject,
						action:
							s.state === 'COMMITTED' ? 'ACCEPTED' : 'ACCEPTANCE_CANCELLED',
						entityVersion: current.version + 1
					}
				});
			});
		}
		const remaining = await this.prisma.acceptance.count({
			where: {
				workspaceId: binding.workspaceId,
				status: { notIn: ['COMPLETED', 'CANCELLED'] }
			}
		});
		return {
			schemaVersion: 1,
			closureId: binding.closureId,
			workspaceId: binding.workspaceId,
			generation: '1',
			state: remaining ? 'SETTLING' : 'SETTLED',
			remaining
		};
	}

	private async assertFence(binding: ClosureEnvelope) {
		const fence = await this.prisma.workspaceClosureFence.findUnique({
			where: { workspaceId: binding.workspaceId }
		});
		if (
			!fence ||
			fence.closureId !== binding.closureId ||
			fence.generation !== 1n ||
			fence.ownerSubject !== binding.ownerSubject ||
			fence.requestedAt?.toISOString() !== binding.requestedAt ||
			!fence.fencedAt
		)
			throw new ConflictException({ code: 'crm_workspace_closure_binding_conflict', message: 'Workspace closure binding differs' });
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
	@Post('settle')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	settle(@Body() body: unknown) {
		return this.closures.settle(envelope(body, true));
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
