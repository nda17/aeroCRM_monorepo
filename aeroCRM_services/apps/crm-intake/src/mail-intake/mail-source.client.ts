import {
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException
} from '@nestjs/common';
import { parseIntakeAccessOrigin } from '../access/intake-authorization.client';

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string) =>
	Object.keys(value).sort().join(',') === expected;
const instant = (value: unknown) =>
	typeof value === 'string' &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value;

export interface MailIntakeSource {
	schemaVersion: 1;
	workspaceId: string;
	subject: string;
	membershipId: string;
	message: {
		id: string;
		mailboxId: string;
		sourceHash: string;
		direction: 'INBOUND';
		subject: string;
		from: Array<{ name: string | null; email: string }>;
		receivedAt: string;
		sentAt: string | null;
		text: string;
		bodyStatus: string;
		textLength: number;
		textTruncated: boolean;
	};
}

export function parseMailIntakeSource(
	value: unknown,
	workspaceId: string,
	messageId: string,
	subject: string
): MailIntakeSource {
	if (
		!record(value) ||
		!keys(value, 'membershipId,message,schemaVersion,subject,workspaceId') ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.subject !== subject ||
		typeof value.membershipId !== 'string' ||
		!UUID.test(value.membershipId) ||
		!record(value.message)
	)
		throw new Error('MAIL_SOURCE_CONTRACT');
	const m = value.message;
	if (
		!keys(
			m,
			'bodyStatus,direction,from,id,mailboxId,receivedAt,sentAt,sourceHash,subject,text,textLength,textTruncated'
		) ||
		m.id !== messageId ||
		typeof m.mailboxId !== 'string' ||
		!UUID.test(m.mailboxId) ||
		m.direction !== 'INBOUND' ||
		typeof m.sourceHash !== 'string' ||
		!/^[0-9a-f]{64}$/.test(m.sourceHash) ||
		typeof m.subject !== 'string' ||
		m.subject.length > 300 ||
		/[\x00-\x1f\x7f]/.test(m.subject) ||
		!Array.isArray(m.from) ||
		m.from.length > 100 ||
		!m.from.every(
			(item) =>
				record(item) &&
				keys(item, 'email,name') &&
				typeof item.email === 'string' &&
				item.email.length <= 254 &&
				/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email) &&
				(item.name === null ||
					(typeof item.name === 'string' &&
						item.name.length <= 200 &&
						!/[\x00-\x1f\x7f]/.test(item.name)))
		) ||
		!instant(m.receivedAt) ||
		!(m.sentAt === null || instant(m.sentAt)) ||
		typeof m.text !== 'string' ||
		m.text.length > 5000 ||
		/[\uD800-\uDBFF]$/.test(m.text) ||
		typeof m.bodyStatus !== 'string' ||
		!['COMPLETE', 'UNAVAILABLE', 'TOO_LARGE'].includes(m.bodyStatus) ||
		!Number.isSafeInteger(m.textLength) ||
		Number(m.textLength) < m.text.length ||
		Number(m.textLength) > 262144 ||
		typeof m.textTruncated !== 'boolean' ||
		m.textTruncated !== Number(m.textLength) > m.text.length
	)
		throw new Error('MAIL_SOURCE_CONTRACT');
	return value as unknown as MailIntakeSource;
}

@Injectable()
export class MailSourceClient {
	async source(
		bearer: string | undefined,
		workspaceId: string,
		messageId: string,
		subject: string
	): Promise<MailIntakeSource> {
		try {
			const origin = parseIntakeAccessOrigin(
				process.env.CRM_CUSTOMERS_INTERNAL_BASE_URL
			);
			const token = process.env.CRM_CUSTOMERS_CRM_INTAKE_TOKEN || '';
			if (
				token.length < 32 ||
				token.length > 4096 ||
				/\s|change[_-]?me|replace-|<[^>]+>/i.test(token)
			)
				throw new Error('MAIL_SOURCE_CONFIGURATION');
			const response = await fetch(
				`${origin}/internal/v1/crm-customers/mail/intake-source`,
				{
					method: 'POST',
					redirect: 'error',
					cache: 'no-store',
					signal: AbortSignal.timeout(10000),
					headers: {
						'content-type': 'application/json',
						'x-aerocrm-service': 'crm-intake',
						'x-aerocrm-internal-token': token,
						...(bearer ? { authorization: bearer } : {})
					},
					body: JSON.stringify({ schemaVersion: 1, workspaceId, messageId })
				}
			);
			if (response.status === 403 && response.body) {
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let size = 0;
				try {
					while (true) {
						const item = await reader.read();
						if (item.done) break;
						size += item.value.byteLength;
						if (size > 4096) {
							await reader.cancel();
							throw new Error('MAIL_SOURCE_DENIAL_SIZE');
						}
						chunks.push(item.value);
					}
				} finally {
					reader.releaseLock();
				}
				const denied: unknown = JSON.parse(
					Buffer.concat(chunks, size).toString('utf8')
				);
				if (
					record(denied) &&
					keys(denied, 'code') &&
					denied.code === 'crm_mail_permission_denied'
				)
					throw new ForbiddenException({
						code: 'crm_intake_mail_source_denied'
					});
				throw new Error('MAIL_SOURCE_UNVERIFIED_DENIAL');
			}
			if (response.status !== 200 || !response.body) {
				await response.body?.cancel();
				if (response.status === 404)
					throw new NotFoundException({
						code: 'crm_intake_mail_source_not_found'
					});
				throw new Error('MAIL_SOURCE_UNAVAILABLE');
			}
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				while (true) {
					const item = await reader.read();
					if (item.done) break;
					size += item.value.byteLength;
					if (size > 65536) {
						await reader.cancel();
						throw new Error('MAIL_SOURCE_TOO_LARGE');
					}
					chunks.push(item.value);
				}
			} finally {
				reader.releaseLock();
			}
			return parseMailIntakeSource(
				JSON.parse(Buffer.concat(chunks, size).toString('utf8')),
				workspaceId,
				messageId,
				subject
			);
		} catch (error) {
			if (
				error instanceof ForbiddenException ||
				error instanceof NotFoundException
			)
				throw error;
			throw new ServiceUnavailableException({
				code: 'crm_intake_mail_source_unavailable'
			});
		}
	}
}
