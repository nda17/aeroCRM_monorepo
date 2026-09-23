import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getCrmAccessCorrelationId } from '../common/crm-access-request-context';
import { parseInternalBaseUrl, parseInternalTimeout, parseInternalToken, readBoundedJson } from '../internal/internal-http.config';
import { parseIntakeSettlementAck, parseParticipantAck,
	type WorkspaceClosureFenceEnvelope, type WorkspaceClosureService } from './workspace-closure.contract';

const TARGETS = {
	identity: ['IDENTITY_INTERNAL_BASE_URL', 'IDENTITY_CRM_ACCESS_TOKEN', 'http://127.0.0.1:4900'],
	billing: ['BILLING_INTERNAL_BASE_URL', 'BILLING_CRM_ACCESS_TOKEN', 'http://127.0.0.1:4800'],
	'crm-customers': ['CRM_CUSTOMERS_INTERNAL_BASE_URL', 'CRM_CUSTOMERS_CRM_ACCESS_TOKEN', 'http://127.0.0.1:5320'],
	'crm-sales': ['CRM_SALES_INTERNAL_BASE_URL', 'CRM_SALES_CRM_ACCESS_TOKEN', 'http://127.0.0.1:5330'],
	'crm-intake': ['CRM_INTAKE_INTERNAL_BASE_URL', 'CRM_INTAKE_CRM_ACCESS_TOKEN', 'http://127.0.0.1:5310'],
	'notification-delivery': ['NOTIFICATION_DELIVERY_INTERNAL_BASE_URL', 'NOTIFICATION_DELIVERY_CRM_ACCESS_TOKEN', 'http://127.0.0.1:4401']
} as const;

@Injectable()
export class WorkspaceClosureClient {
	private readonly timeoutMs: number;
	constructor(private readonly config: ConfigService) {
		this.timeoutMs = parseInternalTimeout('CRM_ACCESS_CLOSURE_TIMEOUT_MS', config.get<string>('CRM_ACCESS_CLOSURE_TIMEOUT_MS'));
	}

	async fence(service: Exclude<WorkspaceClosureService, 'crm-access'>, envelope: WorkspaceClosureFenceEnvelope) {
		const raw = await this.post(service, 'fence', envelope);
		const ack = parseParticipantAck(raw, service, envelope);
		if (!ack) throw new ServiceUnavailableException('Closure participant returned invalid acknowledgment');
		return ack;
	}

	async settleIntake(envelope: WorkspaceClosureFenceEnvelope, customersFencedAt: string, salesFencedAt: string) {
		const raw = await this.post('crm-intake', 'settle', { ...envelope, customersFencedAt, salesFencedAt });
		const ack = parseIntakeSettlementAck(raw, envelope);
		if (!ack) throw new ServiceUnavailableException('Closure settlement returned invalid acknowledgment');
		return ack;
	}

	private async post(service: Exclude<WorkspaceClosureService, 'crm-access'>,
		method: 'fence' | 'settle', body: unknown): Promise<unknown> {
		const [urlName, tokenName, fallback] = TARGETS[service];
		const base = parseInternalBaseUrl(urlName, this.config.get<string>(urlName), fallback);
		const token = parseInternalToken(tokenName, this.config.get<string>(tokenName), [
			`${service.replace(/-/g, '_')}_crm_access_token`, `ci_${service.replace(/-/g, '_')}_crm_access_token_at_least_32_chars`
		]);
		let response: Response;
		try {
			response = await fetch(`${base}/internal/v1/workspace-closures/${method}`, {
				method: 'POST', redirect: 'error', cache: 'no-store',
				headers: { 'x-aerocrm-service': 'crm-access', 'x-aerocrm-internal-token': token,
					'x-correlation-id': getCrmAccessCorrelationId(), 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs)
			});
		} catch { throw new ServiceUnavailableException('Closure participant is unavailable'); }
		if (response.status !== 200 || response.redirected) {
			if (response.status === 409) {
				let body: unknown = null;
				try { body = await readBoundedJson(response, 4096); }
				catch { await response.body?.cancel().catch(() => undefined); }
				if (service === 'crm-intake' && method === 'settle' && body && typeof body === 'object' &&
					'code' in body && body.code === 'crm_workspace_closure_proof_conflict')
					throw new Error('CLOSURE_PROOF_INTEGRITY');
				if (service === 'crm-intake' && method === 'settle' && body && typeof body === 'object' &&
					'code' in body && body.code === 'crm_workspace_closure_acceptance_conflict')
					throw new Error('CLOSURE_ACCEPTANCE_CONFLICT');
				if (service === 'crm-intake' && method === 'settle' && body && typeof body === 'object' &&
					'code' in body && body.code === 'crm_workspace_closure_entry_conflict')
					throw new Error('CLOSURE_ENTRY_CONFLICT');
				throw new Error('CLOSURE_BINDING_CONFLICT');
			}
			await response.body?.cancel();
			if (response.status === 403 && service === 'identity')
				throw new Error('CLOSURE_OWNER_BINDING_CHANGED');
			throw new ServiceUnavailableException('Closure participant refused the request');
		}
		try { return await readBoundedJson(response); }
		catch { throw new ServiceUnavailableException('Closure participant returned invalid JSON'); }
	}
}
