import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CampaignEmailNotificationRequestedEventPayload } from '../messaging/delivery-event.types';

export const MARKETING_EMAIL_CONTEXT_CAPABILITIES = { authorization: 1, request: 3, outcome: 3, unsubscribe: 1 } as const;
export const isBoundMarketingEmailEvent = (event: Pick<CampaignEmailNotificationRequestedEventPayload, 'schemaVersion' | 'recipientUserId'>): boolean =>
	event.schemaVersion === 3 && typeof event.recipientUserId === 'string' && event.recipientUserId.length > 0;

export type MarketingSkipReason = 'MARKETING_NOT_AUTHORIZED' | 'MARKETING_IDENTITY_MISMATCH' | 'MARKETING_IDENTITY_UNBOUND';
export type MarketingEmailDecision = { decision: 'SKIP'; reason: MarketingSkipReason } |
	{ decision: 'ALLOW'; unsubscribeUrl: string };

@Injectable()
export class MarketingEmailContextService {
	constructor(private readonly config: ConfigService) {}

	async authorize(event: CampaignEmailNotificationRequestedEventPayload): Promise<MarketingEmailDecision> {
		if (!isBoundMarketingEmailEvent(event))
			return { decision: 'SKIP', reason: 'MARKETING_IDENTITY_UNBOUND' };
		if (this.config.get<string>('MARKETING_EMAIL_ENABLED') !== 'true')
			return { decision: 'SKIP', reason: 'MARKETING_NOT_AUTHORIZED' };
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);
		try {
			const raw = this.config.get<string>('IDENTITY_INTERNAL_BASE_URL');
			const origin = new URL(raw || '');
			const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
			const token = this.config.get<string>('IDENTITY_NOTIFICATION_DELIVERY_TOKEN') || '';
			const publicOrigin = this.config.get<string>('MARKETING_PUBLIC_ORIGIN');
			const publicUrl = new URL(publicOrigin || '');
			if (!raw || raw !== raw.trim() || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
				(origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
				token.length < 32 || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token) || /^(?:change|replace|example|placeholder|ci_)/i.test(token) ||
				publicUrl.protocol !== 'https:' || publicOrigin !== publicUrl.origin)
				throw new Error('Invalid marketing configuration');
			const response = await fetch(`${origin.origin}/internal/v1/notification-delivery/marketing-email/authorize`, {
				method: 'POST', redirect: 'error', signal: controller.signal,
				headers: { 'content-type': 'application/json', 'x-aerocrm-service': 'notification-delivery', 'x-aerocrm-internal-token': token },
				body: JSON.stringify({ schemaVersion: 1, eventId: event.eventId, campaignId: event.campaignId,
					deliveryId: event.deliveryId, dispatchGeneration: event.dispatchGeneration,
					recipientUserId: event.recipientUserId, destination: event.destination.email })
			});
			if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
				!response.body || Number(response.headers.get('content-length') || 0) > 4096)
				throw new Error('Invalid marketing response');
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					const chunk = await reader.read();
					if (chunk.done) break;
					size += chunk.value.byteLength;
					if (size > 4096) { await reader.cancel(); throw new Error('Oversized marketing response'); }
					chunks.push(chunk.value);
				}
			} finally { reader.releaseLock(); }
			const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid marketing decision');
			const row = value as Record<string, unknown>;
			if (row.schemaVersion !== 1) throw new Error('Invalid marketing version');
			if (row.decision === 'SKIP' && Object.keys(row).sort().join(',') === 'decision,reason,schemaVersion' &&
				(row.reason === 'MARKETING_NOT_AUTHORIZED' || row.reason === 'MARKETING_IDENTITY_MISMATCH'))
				return { decision: 'SKIP', reason: row.reason };
			if (row.decision !== 'ALLOW' || Object.keys(row).sort().join(',') !== 'checkedAt,decision,preferenceVersion,schemaVersion,unsubscribeUrl' ||
				!Number.isSafeInteger(row.preferenceVersion) || Number(row.preferenceVersion) < 1 ||
				typeof row.checkedAt !== 'string' || !Number.isFinite(Date.parse(row.checkedAt)) ||
				Date.parse(row.checkedAt) > Date.now() + 1000 || Date.parse(row.checkedAt) < Date.now() - 10000 ||
				typeof row.unsubscribeUrl !== 'string')
				throw new Error('Invalid marketing allowance');
			const match = row.unsubscribeUrl.match(/#token=([A-Za-z0-9_-]{43})$/);
			if (!match || row.unsubscribeUrl !== `${publicOrigin}/unsubscribe#token=${match[1]}`)
				throw new Error('Invalid marketing unsubscribe links');
			return { decision: 'ALLOW', unsubscribeUrl: row.unsubscribeUrl };
		} catch {
			// Do not expose fetch errors containing internal credentials or unsubscribe tokens.
			throw new Error('Marketing email authorization is unavailable');
		} finally { clearTimeout(timeout); }
	}
}
