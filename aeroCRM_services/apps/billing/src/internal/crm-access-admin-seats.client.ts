import {
	ConflictException,
	Injectable,
	ServiceUnavailableException
} from '@nestjs/common';
import { BillingRuntimeService } from '../runtime/billing-runtime.service';

export type AdminSeatFence = {
	operationId: string;
	requestHash: string;
	fenceRevision: number;
	targetSeats: number;
};

@Injectable()
export class CrmAccessAdminSeatsClient {
	private readonly origin: string;
	private readonly token: string;
	constructor(runtime: BillingRuntimeService) {
		this.origin = '';
		this.token = '';
		if (!runtime.apiEnabled) return;
		const raw =
			process.env.BILLING_CRM_ACCESS_COMMERCE_BASE_URL?.trim() || '';
		let parsed: URL;
		try {
			parsed = new URL(raw);
		} catch {
			throw new Error(
				'BILLING_CRM_ACCESS_COMMERCE_BASE_URL must be configured'
			);
		}
		if (
			parsed.username ||
			parsed.password ||
			parsed.pathname !== '/' ||
			parsed.search ||
			parsed.hash ||
			!(parsed.protocol === 'https:' ||
				(parsed.protocol === 'http:' &&
					['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)))
		)
			throw new Error(
				'BILLING_CRM_ACCESS_COMMERCE_BASE_URL must be an exact HTTPS origin, except loopback HTTP'
			);
		this.origin = parsed.origin;
		this.token =
			process.env.BILLING_CRM_ACCESS_COMMERCE_TOKEN?.trim() || '';
		if (
			this.token.length < 32 ||
			this.token.length > 512 ||
			/\s|change[_-]?me|placeholder|example/i.test(this.token)
		)
			throw new Error(
				'BILLING_CRM_ACCESS_COMMERCE_TOKEN must be a non-placeholder secret'
			);
	}

	context(workspaceId: string) {
		return this.request('context', { schemaVersion: 1, workspaceId });
	}
	prepare(body: Record<string, unknown>) {
		return this.request('prepare', body);
	}
	synchronize(body: Record<string, unknown>) {
		return this.request('synchronize', body);
	}

	private async request(path: string, body: Record<string, unknown>) {
		if (!this.origin || !this.token)
			throw new ServiceUnavailableException(
				'CRM Access seat coordination is unavailable'
			);
		let response: Response;
		let value: unknown;
		try {
			response = await fetch(
				`${this.origin}/internal/v1/crm-access/billing/admin-seats/${path}`,
				{
					method: 'POST',
					headers: {
						'x-aerocrm-service': 'billing',
						'x-aerocrm-internal-token': this.token,
						'content-type': 'application/json',
						accept: 'application/json'
					},
					body: JSON.stringify(body),
					redirect: 'error',
					cache: 'no-store',
					signal: AbortSignal.timeout(8_000)
				}
			);
			value = await this.read(response);
		} catch (error) {
			if (error instanceof ConflictException) throw error;
			throw new ServiceUnavailableException(
				'CRM Access seat coordination is unavailable'
			);
		}
		if (response.status === 409)
			throw new ConflictException({
				code: 'crm_admin_subscription_operation_pending',
				message: 'В CRM уже выполняется операция изменения мест'
			});
		if (!response.ok || !this.valid(path, value, body))
			throw new ServiceUnavailableException(
				'CRM Access seat coordination returned an invalid response'
			);
		return value as Record<string, unknown>;
	}

	private valid(path: string, value: unknown, body: Record<string, unknown>) {
		if (!record(value) || value.schemaVersion !== 1 || value.workspaceId !== body.workspaceId)
			return false;
		if (path === 'context')
			return (
				exact(value, [
					'schemaVersion',
					'workspaceId',
					'usedSeats',
					'pendingOperationId'
				]) &&
				integer(value.usedSeats, 1, 10000) &&
				(value.pendingOperationId === null || uuid(value.pendingOperationId))
			);
		if (
			!exact(value, [
				'schemaVersion',
				'workspaceId',
				'commandId',
				'actorSubject',
				'requestHash',
				'state',
				'releaseFence',
				'capacityFence'
			]) ||
			value.commandId !== body.commandId ||
			value.actorSubject !== body.actorSubject ||
			value.requestHash !== body.requestHash ||
			!['PENDING', 'COMMITTED', 'CANCELLED'].includes(String(value.state)) ||
			typeof value.releaseFence !== 'boolean' ||
			!fence(value.capacityFence, body.commandId, body.requestHash)
		)
			return false;
		if (
			path === 'prepare' &&
			(value.capacityFence as AdminSeatFence).targetSeats !== body.targetSeats
		)
			return false;
		return path !== 'synchronize' || value.releaseFence === true;
	}

	private async read(response: Response): Promise<unknown> {
		if (
			response.redirected ||
			response.headers
				.get('content-type')
				?.split(';')[0]
				.trim()
				.toLowerCase() !== 'application/json' ||
			!response.body
		)
			throw new Error('INVALID_RESPONSE');
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		try {
			while (true) {
				const next = await reader.read();
				if (next.done) break;
				bytes += next.value.byteLength;
				if (bytes > 32_768) throw new Error('BODY_TOO_LARGE');
				chunks.push(next.value);
			}
		} finally {
			reader.releaseLock();
		}
		return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
	}
}

const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => {
	const present = Object.keys(value).sort();
	const expected = [...keys].sort();
	return present.length === expected.length && present.every((key, i) => key === expected[i]);
};
const uuid = (value: unknown): value is string =>
	typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const integer = (value: unknown, min: number, max: number): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const fence = (value: unknown, commandId: unknown, requestHash: unknown): value is AdminSeatFence =>
	record(value) &&
	exact(value, ['operationId', 'requestHash', 'fenceRevision', 'targetSeats']) &&
	value.operationId === commandId &&
	value.requestHash === requestHash &&
	integer(value.fenceRevision, 1, 2147483646) &&
	integer(value.targetSeats, 2, 10000);
