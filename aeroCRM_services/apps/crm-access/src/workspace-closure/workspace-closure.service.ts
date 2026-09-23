import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrmAccessLifecycle, Prisma, type CrmWorkspaceClosure } from '@prisma/crm-access-client';
import { randomUUID } from 'node:crypto';
import { getCrmAccessCorrelationId } from '../common/crm-access-request-context';
import { IdentityAuthContextClient } from '../internal/identity-auth-context.client';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { json, semanticHash, serializable, workspaceLock } from '../team/team.util';
import { CLOSURE_PARTICIPANT_SERVICES, type WorkspaceClosureCommand,
	type WorkspaceClosureService as WorkspaceClosureServiceName, type WorkspaceClosureView } from './workspace-closure.contract';

export type ClosureStep = { state: 'PENDING' | 'FENCED' | 'SETTLED'; fencedAt: string | null;
	settledAt: string | null; lastErrorCode: string | null };
export type ClosureParticipants = Record<WorkspaceClosureServiceName, ClosureStep>;

export function closureParticipants(at: string): ClosureParticipants {
	return Object.fromEntries(CLOSURE_PARTICIPANT_SERVICES.map(service => [service,
		{ state: service === 'crm-access' ? 'SETTLED' : 'PENDING',
			fencedAt: service === 'crm-access' ? at : null,
			settledAt: service === 'crm-access' ? at : null, lastErrorCode: null }])) as ClosureParticipants;
}

@Injectable()
export class WorkspaceClosureService {
	readonly admissionEnabled: boolean;
	constructor(private readonly prisma: CrmAccessPrismaService,
		private readonly identity: IdentityAuthContextClient,
		config: ConfigService) {
		const flag = config.get<string>('CRM_ACCESS_CLOSURE_ENABLED')?.trim() || 'false';
		if (!['true', 'false'].includes(flag)) throw new Error('CRM_ACCESS_CLOSURE_ENABLED must be true or false');
		this.admissionEnabled = flag === 'true';
	}

	async preview(authorization: string | undefined, workspaceId: string) {
		const subject = await this.subject(authorization);
		const existing = await this.prisma.crmWorkspaceClosure.findUnique({ where: { workspaceId } });
		if (existing) await this.closedOwner(existing, subject);
		else await this.activeOwner(workspaceId, subject);
		const branding = existing ? null : await this.prisma.crmWorkspaceBranding.findUnique({
			where: { workspaceId }, select: { displayName: true }
		});
		const displayName = existing?.displayNameSnapshot ?? branding?.displayName ?? null;
		return { schemaVersion: 1 as const, scope: { subject, workspaceId },
			enabled: this.admissionEnabled && !existing,
			version: '0' as const,
			confirmationLabel: this.label(displayName, workspaceId),
			closure: existing ? this.view(existing) : null };
	}

	async create(authorization: string | undefined, command: WorkspaceClosureCommand) {
		const subject = await this.subject(authorization);
		const existing = await this.prisma.crmWorkspaceClosure.findUnique({ where: { workspaceId: command.workspaceId } });
		const hash = semanticHash({ subject, command });
		if (existing) {
			await this.closedOwner(existing, subject);
			if (existing.commandId !== command.commandId || existing.requestHash !== hash)
				throw new ConflictException({ code: 'crm_workspace_closure_exists', operationId: existing.id });
			await this.prisma.crmWorkspaceClosure.updateMany({ where: { id: existing.id, state: 'CLOSING' },
				data: { nextAttemptAt: new Date() } });
			return { schemaVersion: 1 as const, closure: this.view(existing) };
		}
		if (!this.admissionEnabled) throw new ForbiddenException({ code: 'crm_workspace_closure_disabled' });
		const ownerMembershipId = await this.activeOwner(command.workspaceId, subject);
		const closure = await serializable(this.prisma, async tx => {
			await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-workspace-closure-command:${command.commandId}`}, 0))`;
			const reused = await tx.crmWorkspaceClosure.findUnique({ where: { commandId: command.commandId } });
			if (reused && reused.workspaceId !== command.workspaceId)
				throw new ConflictException({ code: 'crm_workspace_closure_command_conflict' });
			await workspaceLock(tx, command.workspaceId);
			const prior = await tx.crmWorkspaceClosure.findUnique({ where: { workspaceId: command.workspaceId } });
			if (prior) {
				if (prior.commandId !== command.commandId || prior.requestHash !== hash || prior.ownerSubject !== subject)
					throw new ConflictException({ code: 'crm_workspace_closure_exists', operationId: prior.id });
				return prior;
			}
			const branding = await tx.crmWorkspaceBranding.findUnique({ where: { workspaceId: command.workspaceId },
				select: { displayName: true } });
			const displayName = branding?.displayName ?? null;
			if (command.confirmationLabel !== this.label(displayName, command.workspaceId))
				throw new ConflictException({ code: 'crm_workspace_closure_label_changed' });
			await tx.$executeRaw`SELECT crm_access.assert_workspace_open(${command.workspaceId}::uuid)`;
			const access = await tx.crmWorkspaceAccess.findUnique({ where: { workspaceId: command.workspaceId } });
			if (access && access.lifecycle !== CrmAccessLifecycle.SUSPENDED)
				await tx.crmWorkspaceAccess.update({ where: { workspaceId: command.workspaceId },
					data: { lifecycle: CrmAccessLifecycle.SUSPENDED } });
			await tx.crmInvitationIntent.updateMany({ where: { workspaceId: command.workspaceId,
					status: { in: ['REGISTERING','INVITED'] } },
				data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } } });
			await tx.crmAdmission.updateMany({ where: { workspaceId: command.workspaceId, status: 'WAITING' },
				data: { status: 'CANCELLED', cancellationCode: 'WORKSPACE_CLOSED' } });
			const now = new Date();
			const row = await tx.crmWorkspaceClosure.create({ data: {
				id: randomUUID(), workspaceId: command.workspaceId, commandId: command.commandId,
				ownerSubject: subject, ownerMembershipId, requestHash: hash,
				displayNameSnapshot: displayName, state: 'CLOSING', participants: json(closureParticipants(now.toISOString())),
				requestedAt: now, nextAttemptAt: now
			} });
			await tx.workspaceClosureFence.update({ where: { workspaceId: command.workspaceId },
				data: { closureId: row.id, generation: 1n, ownerSubject: subject, requestedAt: now,
					fencedAt: now, revision: { increment: 1 } } });
			await tx.crmTeamAudit.create({ data: { workspaceId: command.workspaceId,
				actorSubject: subject, commandId: command.commandId, action: 'WORKSPACE_CLOSURE_REQUESTED',
				targetId: row.id, before: Prisma.JsonNull,
				after: json({ closureId: row.id, state: 'CLOSING' }) } });
			return row;
		});
		return { schemaVersion: 1 as const, closure: this.view(closure) };
	}

	async get(authorization: string | undefined, id: string) {
		const subject = await this.subject(authorization);
		const row = await this.prisma.crmWorkspaceClosure.findUnique({ where: { id } });
		if (!row) throw new NotFoundException('Closure was not found');
		await this.closedOwner(row, subject);
		return { schemaVersion: 1 as const, closure: this.view(row) };
	}

	async list(authorization: string | undefined) {
		const subject = await this.subject(authorization);
		const rows = await this.prisma.crmWorkspaceClosure.findMany({ where: { ownerSubject: subject },
			orderBy: { requestedAt: 'desc' }, take: 100 });
		const items: WorkspaceClosureView[] = [];
		for (const row of rows) {
			try { await this.closedOwner(row, subject); items.push(this.view(row)); }
			catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
		}
		return { schemaVersion: 1 as const, scope: { subject }, items };
	}

	async requireClosedOwner(authorization: string | undefined, closureId: string) {
		const subject = await this.subject(authorization);
		const row = await this.prisma.crmWorkspaceClosure.findUnique({ where: { id: closureId } });
		if (!row || row.state !== 'CLOSED') throw new NotFoundException('Closed workspace was not found');
		await this.closedOwner(row, subject);
		return { workspaceId: row.workspaceId, actorSubject: subject };
	}

	view(row: CrmWorkspaceClosure): WorkspaceClosureView {
		const participants = row.participants as unknown as ClosureParticipants;
		return { id: row.id, workspaceId: row.workspaceId, displayName: row.displayNameSnapshot,
			state: row.state as 'CLOSING' | 'CLOSED', version: row.version.toString(),
			requestedAt: row.requestedAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null,
			steps: CLOSURE_PARTICIPANT_SERVICES.map(service => ({ service,
				state: participants[service].state, lastErrorCode: participants[service].lastErrorCode })),
			financialPendingCount: row.financialPendingCount, priorDispatchCount: row.priorDispatchCount,
			lastErrorCode: row.lastErrorCode };
	}

	private async subject(authorization: string | undefined) {
		return (await this.identity.authContext(authorization, getCrmAccessCorrelationId())).subject;
	}

	private async activeOwner(workspaceId: string, subject: string): Promise<string> {
		const context = await this.identity.ownerContext(workspaceId, subject, getCrmAccessCorrelationId());
		if (context.ownerSubject !== subject || context.membership?.role !== 'OWNER')
			throw new ForbiddenException('Workspace owner authority is required');
		return context.membership.membershipId;
	}

	private async closedOwner(row: CrmWorkspaceClosure, subject: string) {
		if (row.ownerSubject !== subject) throw new ForbiddenException('Workspace owner authority is required');
		const context = await this.identity.closureOwnerContext(row.workspaceId, row.id, subject,
			getCrmAccessCorrelationId());
		if (context.membershipId !== row.ownerMembershipId)
			throw new ForbiddenException('Workspace owner binding changed');
	}

	private label(name: string | null, workspaceId: string) {
		return name?.trim() || `Пространство без названия · ${workspaceId.slice(0, 8)}`;
	}
}
