import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

type BotResponse<T> = { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
type BusinessConnection = {
	id: string;
	user: { id: number; first_name?: string; last_name?: string; username?: string };
	is_enabled: boolean;
	can_reply?: boolean;
	rights?: { can_reply?: boolean };
};

export class TelegramTransportError extends Error {
	constructor(
		readonly kind: 'NETWORK' | 'REJECTED' | 'AMBIGUOUS',
		readonly status: number | null,
		readonly retryAfter: number | null
	) {
		super(`Telegram ${kind.toLowerCase()}`);
	}
}

export const telegramApiProxyLookup = (proxyIp: string): LookupFunction => (_hostname, options, callback) => {
	if (options.all) callback(null, [{ address: proxyIp, family: 4 }]);
	else callback(null, proxyIp, 4);
};

@Injectable()
export class TelegramBusinessBot {
	readonly enabled: boolean;
	readonly username: string;
	readonly secret: string;
	private readonly token: string;
	private readonly base: URL;
	private readonly proxyIp: string;

	constructor() {
		this.enabled = process.env.TELEGRAM_BUSINESS_ENABLED === 'true';
		this.username = process.env.TELEGRAM_BUSINESS_BOT_USERNAME?.replace(/^@/, '') || 'aerocrm_tech_bot';
		this.secret = process.env.TELEGRAM_BUSINESS_WEBHOOK_SECRET || '';
		this.token = process.env.TELEGRAM_BUSINESS_BOT_TOKEN || '';
		this.base = new URL(process.env.TELEGRAM_BUSINESS_API_BASE_URL || 'https://telegram.aerocrm.space/telegram-api');
		this.proxyIp = process.env.TELEGRAM_BUSINESS_API_PROXY_IP || '';
		if (this.enabled && (!this.token || this.secret.length < 32 || !this.proxyIp || isIP(this.proxyIp) !== 4 || this.base.protocol !== 'https:' || this.base.hostname !== 'telegram.aerocrm.space'))
			throw new Error('Telegram Business transport configuration is incomplete');
	}

	get configured() { return this.enabled && !!this.token && this.secret.length >= 32; }

	private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
		if (!this.configured) throw new ServiceUnavailableException('Telegram Business is not configured');
		const url = new URL(`${this.base.pathname.replace(/\/$/, '')}/bot${this.token}/${method}`, this.base);
		const payload = Buffer.from(JSON.stringify(body));
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const fail = (error: TelegramTransportError) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(error);
			};
			const succeed = (result: T) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(result);
			};
			const req = request(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'content-length': payload.length },
				lookup: telegramApiProxyLookup(this.proxyIp),
				timeout: 10_000,
				rejectUnauthorized: true
			}, response => {
				const chunks: Buffer[] = [];
				let length = 0;
				response.on('aborted', () => fail(new TelegramTransportError('AMBIGUOUS', response.statusCode ?? null, null)));
				response.on('error', () => fail(new TelegramTransportError('AMBIGUOUS', response.statusCode ?? null, null)));
				response.on('close', () => {
					if (!response.complete) fail(new TelegramTransportError('AMBIGUOUS', response.statusCode ?? null, null));
				});
				response.on('data', (chunk: Buffer) => {
					length += chunk.length;
					if (length > 256 * 1024) { fail(new TelegramTransportError('AMBIGUOUS', response.statusCode ?? null, null)); req.destroy(); return; }
					chunks.push(chunk);
				});
				response.on('end', () => {
					if (settled) return;
					let parsed: BotResponse<T> | null;
					try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as BotResponse<T> | null; }
					catch { fail(new TelegramTransportError('AMBIGUOUS', response.statusCode ?? null, null)); return; }
					if (!parsed || typeof parsed !== 'object' || typeof parsed.ok !== 'boolean') {
						fail(new TelegramTransportError('AMBIGUOUS', response.statusCode ?? null, null)); return;
					}
					if (parsed.ok) {
						if (parsed.result === undefined || parsed.result === null) fail(new TelegramTransportError('AMBIGUOUS', response.statusCode ?? null, null));
						else succeed(parsed.result);
						return;
					}
					const code = Number.isInteger(parsed.error_code) ? parsed.error_code! : response.statusCode ?? 0;
					fail(new TelegramTransportError(code >= 500 || code < 400 ? 'AMBIGUOUS' : 'REJECTED', code, parsed.parameters?.retry_after ?? null));
				});
			});
			const timer = setTimeout(() => {
				fail(new TelegramTransportError('AMBIGUOUS', null, null));
				req.destroy();
			}, 12_000);
			timer.unref();
			req.on('timeout', () => { fail(new TelegramTransportError('AMBIGUOUS', null, null)); req.destroy(); });
			req.on('error', error => fail(error instanceof TelegramTransportError ? error : new TelegramTransportError('NETWORK', null, null)));
			req.end(payload);
		});
	}

	async getConnection(id: string): Promise<BusinessConnection> {
		const result = await this.call<BusinessConnection>('getBusinessConnection', { business_connection_id: id });
		if (!result || typeof result !== 'object' || result.id !== id || !result.user || !Number.isSafeInteger(result.user.id) || typeof result.is_enabled !== 'boolean')
			throw new TelegramTransportError('AMBIGUOUS', null, null);
		return result;
	}

	async sendMessage(connectionId: string, chatId: string, text: string): Promise<{ message_id: number; chat: { id: number } }> {
		return this.call('sendMessage', { business_connection_id: connectionId, chat_id: chatId, text });
	}

	async sendBotMessage(chatId: string, text: string, replyMarkup?: object): Promise<{ message_id: number }> {
		return this.call('sendMessage', { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
	}

	async answerCallback(id: string, text: string): Promise<boolean> {
		return this.call('answerCallbackQuery', { callback_query_id: id, text });
	}

	botKey(): string { return createHash('sha256').update(this.token).digest('hex').slice(0, 32); }
}
