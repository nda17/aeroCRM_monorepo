import { BeforeApplicationShutdown, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, type CrmWorkspaceClosure } from '@prisma/crm-access-client';
import { randomUUID } from 'node:crypto';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { CrmAccessRuntimeService } from '../runtime/crm-access-runtime.service';
import { json } from '../team/team.util';
import { CLOSURE_PARTICIPANT_SERVICES, type WorkspaceClosureFenceEnvelope,
	type WorkspaceClosureService } from './workspace-closure.contract';
import { WorkspaceClosureClient } from './workspace-closure.client';
import { type ClosureParticipants } from './workspace-closure.service';

const LEASE_MS = 30_000;

@Injectable()
export class WorkspaceClosureWorker implements OnModuleInit, BeforeApplicationShutdown {
	private timer: NodeJS.Timeout | undefined;
	private active: Promise<void> | undefined;
	private stopping = false;
	constructor(private readonly prisma: CrmAccessPrismaService,
		private readonly client: WorkspaceClosureClient,
		private readonly runtime: CrmAccessRuntimeService) {}

	onModuleInit() { if (this.runtime.workerEnabled) this.schedule(); }
	private schedule() {
		if (this.stopping) return;
		this.timer = setTimeout(() => {
			this.active = this.tick().catch(() => undefined).finally(() => {
				this.active = undefined; this.schedule();
			});
		}, 5000);
	}

	async tick() {
		const due = await this.prisma.crmWorkspaceClosure.findMany({ where: { state: 'CLOSING',
			nextAttemptAt: { lte: new Date() }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
			orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: 20,
			select: { id: true, version: true } });
		for (const candidate of due) {
			if (this.stopping) break;
			const token = randomUUID();
			const claim = await this.prisma.crmWorkspaceClosure.updateMany({ where: { id: candidate.id,
				version: candidate.version, state: 'CLOSING', nextAttemptAt: { lte: new Date() },
				OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
				data: { leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS),
					version: { increment: 1 } } });
			if (!claim.count) continue;
			try { await this.process(candidate.id, token); }
			catch (error) { await this.retry(candidate.id, token, this.errorCode(error)); }
		}
	}

	private async process(id: string, token: string) {
		for (const service of CLOSURE_PARTICIPANT_SERVICES) {
			if (service === 'crm-access') continue;
			try {
				let row = await this.current(id, token);
				if (!row) return;
				let step = this.steps(row)[service];
				if (step.state === 'PENDING') {
					const ack = await this.client.fence(service, this.envelope(row));
					row = await this.step(row, token, service, 'FENCED', ack.fencedAt,
						ack.financialPendingCount, ack.priorDispatchCount);
					if (!row) return;
					step = this.steps(row)[service];
				}
				if (step.state === 'FENCED' && service !== 'crm-intake') {
					row = await this.step(row, token, service, 'SETTLED', new Date().toISOString());
					if (!row) return;
				}
			} catch (error) {
				await this.stepError(id, token, service, this.errorCode(error));
			}
		}
		let row = await this.current(id, token);
		if (!row) return;
		const steps = this.steps(row);
		if (steps['crm-intake'].state === 'FENCED' &&
			steps['crm-customers'].fencedAt && steps['crm-sales'].fencedAt) {
			try {
				const ack = await this.client.settleIntake(this.envelope(row),
					steps['crm-customers'].fencedAt, steps['crm-sales'].fencedAt);
				if (ack.state === 'SETTLED') {
					row = await this.step(row, token, 'crm-intake', 'SETTLED', new Date().toISOString());
					if (!row) return;
				}
			} catch (error) {
				await this.stepError(id, token, 'crm-intake', this.errorCode(error));
				row = await this.current(id, token);
				if (!row) return;
			}
		}
		if (CLOSURE_PARTICIPANT_SERVICES.every(service => this.steps(row!)[service].state === 'SETTLED')) {
			await this.prisma.$transaction(async tx => {
				const changed = await tx.crmWorkspaceClosure.updateMany({ where: { id, leaseToken: token,
					version: row!.version, state: 'CLOSING' },
					data: { state: 'CLOSED', closedAt: new Date(), leaseToken: null, leaseUntil: null,
						lastErrorCode: null, version: { increment: 1 } } });
				if (changed.count) await this.audit(tx, row!, 'WORKSPACE_CLOSURE_CLOSED', 'CLOSED');
			});
			return;
		}
		const pendingErrors = CLOSURE_PARTICIPANT_SERVICES.some(service =>
			this.steps(row!)[service].lastErrorCode !== null);
		await this.prisma.crmWorkspaceClosure.updateMany({ where: { id, leaseToken: token,
			version: row.version, state: 'CLOSING' }, data: { leaseToken: null, leaseUntil: null,
				nextAttemptAt: new Date(Date.now() + (pendingErrors ? 15000 : 5000)), version: { increment: 1 } } });
	}

	private async stepError(id: string, token: string, service: WorkspaceClosureService, code: string) {
		const row = await this.current(id, token);
		if (!row) return;
		const steps = this.steps(row);
		steps[service] = { ...steps[service], lastErrorCode: code };
		await this.prisma.crmWorkspaceClosure.updateMany({ where: { id, leaseToken: token,
			version: row.version, state: 'CLOSING' }, data: { participants: json(steps), lastErrorCode: code,
				leaseUntil: new Date(Date.now() + LEASE_MS), version: { increment: 1 } } });
	}

	private async step(row: CrmWorkspaceClosure, token: string, service: WorkspaceClosureService,
		state: 'FENCED' | 'SETTLED', at: string, financialPendingCount = 0,
		priorDispatchCount = 0): Promise<CrmWorkspaceClosure | null> {
		const steps = this.steps(row);
		const before = steps[service];
		if (state === 'FENCED' && before.state !== 'PENDING') return row;
		if (state === 'SETTLED' && before.state !== 'FENCED') return row;
		steps[service] = state === 'FENCED'
			? { state, fencedAt: at, settledAt: null, lastErrorCode: null }
			: { ...before, state, settledAt: at, lastErrorCode: null };
		return this.prisma.$transaction(async tx => {
			const changed = await tx.crmWorkspaceClosure.updateMany({ where: { id: row.id,
				leaseToken: token, version: row.version, state: 'CLOSING' },
				data: { participants: json(steps), lastErrorCode: Object.values(steps).find(step => step.lastErrorCode)?.lastErrorCode ?? null,
					financialPendingCount: row.financialPendingCount + financialPendingCount,
					priorDispatchCount: row.priorDispatchCount + priorDispatchCount,
					leaseUntil: new Date(Date.now() + LEASE_MS), version: { increment: 1 } } });
			if (!changed.count) return null;
			await this.audit(tx, row, state === 'FENCED' ? 'WORKSPACE_CLOSURE_PARTICIPANT_FENCED' :
				'WORKSPACE_CLOSURE_PARTICIPANT_SETTLED', service);
			return tx.crmWorkspaceClosure.findUniqueOrThrow({ where: { id: row.id } });
		});
	}

	private async retry(id: string, token: string, code: string) {
		try {
			const row = await this.current(id, token);
			if (!row) return;
			await this.prisma.crmWorkspaceClosure.updateMany({ where: { id, leaseToken: token,
				version: row.version, state: 'CLOSING' },
				data: { leaseToken: null, leaseUntil: null, lastErrorCode: code,
					nextAttemptAt: new Date(Date.now() + 15000), version: { increment: 1 } } });
		} catch { /* The lease expires and another worker can resume. */ }
	}

	private async current(id: string, token: string) {
		const row = await this.prisma.crmWorkspaceClosure.findUnique({ where: { id } });
		return row?.state === 'CLOSING' && row.leaseToken === token ? row : null;
	}

	private steps(row: CrmWorkspaceClosure): ClosureParticipants {
		return structuredClone(row.participants) as ClosureParticipants;
	}

	private envelope(row: CrmWorkspaceClosure): WorkspaceClosureFenceEnvelope {
		return { schemaVersion: 1, closureId: row.id, workspaceId: row.workspaceId,
			generation: '1', ownerSubject: row.ownerSubject, requestedAt: row.requestedAt.toISOString() };
	}

	private async audit(tx: Prisma.TransactionClient, row: CrmWorkspaceClosure, action: string, service: string) {
		await tx.crmTeamAudit.create({ data: { workspaceId: row.workspaceId,
			actorSubject: row.ownerSubject, commandId: randomUUID(), action, targetId: row.id,
			before: Prisma.JsonNull, after: json({ closureId: row.id, service }) } });
	}

	private errorCode(error: unknown) {
		if (error instanceof Error && ['CLOSURE_OWNER_BINDING_CHANGED',
			'CLOSURE_BINDING_CONFLICT', 'CLOSURE_PROOF_INTEGRITY',
			'CLOSURE_ACCEPTANCE_CONFLICT', 'CLOSURE_ENTRY_CONFLICT'].includes(error.message))
			return error.message;
		if (error && typeof error === 'object' && 'code' in error &&
			((error as { code?: string }).code === 'P2034' ||
				((error as { code?: string }).code === 'P2010' && 'meta' in error &&
					['40001', '40P01'].includes(String((error.meta as { code?: unknown })?.code)))))
			return 'CLOSURE_SERIALIZATION_RETRY';
		return 'CLOSURE_PARTICIPANT_UNAVAILABLE';
	}

	async beforeApplicationShutdown() {
		this.stopping = true;
		if (this.timer) clearTimeout(this.timer);
		await this.active;
	}
}
