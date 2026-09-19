import {
	BadRequestException,
	Injectable,
	UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	Prisma,
	TelegramBotKind,
	VerificationChallengePurpose,
	VerificationChallengeType,
	WebhookReceiptStatus
} from '@prisma/identity-client';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import {
	clientIp,
	safeEqual,
	sha256
} from '../common/identity.util';
import { IdentityEventsService } from '../events/identity-events.service';
import { IdentityPrismaService } from '../prisma/identity-prisma.service';

type TelegramUser = {
	id: number;
	username?: string;
	first_name?: string;
	last_name?: string;
};

type TelegramChat = {
	id: number | string;
	type?: string;
};

type TelegramMessage = {
	message_id?: number;
	text?: string;
	chat: TelegramChat;
	from?: TelegramUser;
};

export type TelegramWebhookUpdate = {
	update_id?: number;
	message?: TelegramMessage;
};

type TelegramApiEnvelope = {
	ok?: boolean;
	description?: string;
	result?: Record<string, unknown>;
};

type TelegramWebhookKind = 'INFO';

const WEBHOOK_LEASE_MS = 120_000;

@Injectable()
export class TelegramService {
	constructor(
		private readonly config: ConfigService,
		private readonly prisma: IdentityPrismaService,
		private readonly events: IdentityEventsService
	) {}

	async handleInfoWebhook(update: TelegramWebhookUpdate, secret?: string) {
		this.assertWebhookSecret('INFO', secret);
		if (update.message && update.message.chat.type !== 'private')
			return true;
		return this.withWebhookReceipt(
			TelegramBotKind.INFO,
			update,
			async () => {
				if (update.message) await this.handleInfoMessage(update.message);
			}
		);
	}

	adminSettings() {
		return {
			infoTelegramBotTokenConfigured: Boolean(this.botToken('INFO')),
			infoTelegramBotUsernameConfigured: Boolean(this.botUsername('INFO'))
		};
	}

	infoWebhookStatus() {
		return this.webhookStatus('INFO');
	}

	private async webhookStatus(kind: TelegramWebhookKind) {
		const config = this.webhookConfig(kind);
		const token = this.botToken(kind);
		const username = this.botUsername(kind);
		let expectedWebhookUrl: string | null = null;
		try {
			expectedWebhookUrl = this.webhookUrl(kind);
		} catch (error) {
			return this.webhookFailure(
				kind,
				token,
				username,
				null,
				error instanceof Error ? error.message : String(error)
			);
		}
		if (!token) {
			return this.webhookFailure(
				kind,
				token,
				username,
				expectedWebhookUrl,
				config.notConfiguredError
			);
		}
		try {
			const [webhook, bot] = await Promise.all([
				this.telegramApi(token, 'getWebhookInfo'),
				this.telegramApi(token, 'getMe')
			]);
			const result = webhook.result || {};
			const botResult = bot.result || {};
			const webhookUrl = this.string(result.url) || null;
			const actualUsername = this.string(botResult.username) || null;
			const lastErrorDate = this.number(result.last_error_date);
			const allowedUpdates = Array.isArray(result.allowed_updates)
				? result.allowed_updates.filter(
						(value): value is string => typeof value === 'string'
					)
				: null;
			return {
				bot: config.bot,
				title: config.title,
				configured: true,
				ok: webhook.ok === true,
				expectedWebhookUrl,
				webhookUrl,
				webhookMatchesExpected: webhookUrl === expectedWebhookUrl,
				pendingUpdateCount: this.number(result.pending_update_count) ?? 0,
				lastErrorAt:
					lastErrorDate === undefined
						? null
						: new Date(lastErrorDate * 1_000).toISOString(),
				lastErrorMessage: this.string(result.last_error_message) || null,
				allowedUpdates,
				secretConfigured: Boolean(this.webhookSecret(kind)),
				configuredUsername: username || null,
				actualUsername,
				usernameMatchesConfigured: username
					? actualUsername === username
					: null,
				error: webhook.ok === true ? null : webhook.description || null
			};
		} catch (error) {
			return this.webhookFailure(
				kind,
				token,
				username,
				expectedWebhookUrl,
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	reinstallInfoWebhook(actorId: string, request: Request) {
		return this.reinstallWebhook('INFO', actorId, request);
	}

	private async reinstallWebhook(
		kind: TelegramWebhookKind,
		actorId: string,
		request: Request
	) {
		const config = this.webhookConfig(kind);
		const token = this.botToken(kind, true);
		const webhookUrl = this.webhookUrl(kind);
		await this.telegramApi(token, 'deleteWebhook', {
			drop_pending_updates: true
		});
		await this.telegramApi(token, 'setWebhook', {
			url: webhookUrl,
			drop_pending_updates: true,
			max_connections: 40,
			allowed_updates: config.allowedUpdates,
			secret_token: this.webhookSecret(kind, true)
		});
		const result = {
			bot: config.bot,
			title: config.title,
			webhookUrl,
			dropPendingUpdates: true,
			allowedUpdates: config.allowedUpdates,
			secretConfigured: true,
			installedAt: new Date().toISOString()
		};
		await this.prisma.$transaction(transaction =>
			this.events.emitAudit(transaction, {
				actorId,
				section: 'TELEGRAM_BOT',
				action: 'TELEGRAM_BOT_WEBHOOK_REINSTALL',
				entityType: 'telegram_webhook',
				entityId: config.bot,
				entityLabel: config.title,
				description: `Переустановлен webhook ${config.title}`,
				metadata: {
					bot: result.bot,
					title: result.title,
					dropPendingUpdates: result.dropPendingUpdates,
					allowedUpdates: result.allowedUpdates,
					secretConfigured: result.secretConfigured,
					installedAt: result.installedAt
				},
				requestId: request.header('x-request-id'),
				requestIp: clientIp(request),
				requestUserAgent: request.get('user-agent')?.slice(0, 500),
				correlationId: request.header('x-correlation-id')
			})
		);
		return result;
	}

	private async handleInfoMessage(message: TelegramMessage) {
		if (message.chat.type !== 'private') return;
		const requestId = this.startArgument(message.text);
		if (!requestId || !message.from) {
			await this.sendMessage(
				'INFO',
				message.chat.id,
				'Откройте Info_bot кнопкой в профиле aeroCRM.'
			);
			return;
		}
		const now = new Date();
		const challenge = await this.prisma.verificationChallenge.findUnique({
			where: {
				type_purpose_value: {
					type: VerificationChallengeType.TELEGRAM,
					purpose:
						VerificationChallengePurpose.BIND_TELEGRAM_NOTIFICATIONS,
					value: requestId
				}
			}
		});
		if (!challenge?.userId || challenge.expiresAt <= now) {
			if (challenge) {
				await this.prisma.verificationChallenge.deleteMany({
					where: { id: challenge.id }
				});
			}
			await this.sendMessage('INFO', message.chat.id, 'Ссылка истекла.');
			return;
		}
		const chatId = String(message.chat.id);
		await this.prisma.$transaction(
			async transaction => {
				const occupied =
					await transaction.telegramNotificationChannel.findUnique({
						where: { chatId }
					});
				if (occupied && occupied.userId !== challenge.userId) {
					throw new BadRequestException(
						'This Telegram chat is already linked to another profile'
					);
				}
				await transaction.telegramNotificationChannel.upsert({
					where: { userId: challenge.userId! },
					create: {
						userId: challenge.userId!,
						chatId,
						telegramUserId: String(message.from!.id),
						username: message.from!.username || null,
						firstName: message.from!.first_name || null,
						lastName: message.from!.last_name || null,
						isActive: true,
						connectedAt: now,
						disabledAt: null
					},
					update: {
						chatId,
						telegramUserId: String(message.from!.id),
						username: message.from!.username || null,
						firstName: message.from!.first_name || null,
						lastName: message.from!.last_name || null,
						isActive: true,
						connectedAt: now,
						disabledAt: null
					}
				});
				await transaction.verificationChallenge.delete({
					where: { id: challenge.id }
				});
				await this.events.emitUserChanged(transaction, challenge.userId!);
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
		);
		await this.sendMessage(
			'INFO',
			chatId,
			'Telegram-уведомления подключены.'
		);
	}

	private async withWebhookReceipt(
		botKind: TelegramBotKind,
		update: TelegramWebhookUpdate,
		handle: () => Promise<void>
	) {
		if (
			!Number.isSafeInteger(update.update_id) ||
			Number(update.update_id) < 0
		) {
			throw new BadRequestException('Telegram update_id is required');
		}
		const updateId = BigInt(update.update_id!);
		const payloadHash = sha256(JSON.stringify(update));
		const leaseToken = randomUUID();
		const now = new Date();
		const leaseExpiresAt = new Date(now.getTime() + WEBHOOK_LEASE_MS);
		const claim = await this.prisma.$transaction(
			async transaction => {
				const created = await transaction.telegramUpdateReceipt.createMany(
					{
						data: [
							{
								botKind,
								updateId,
								payloadHash,
								status: WebhookReceiptStatus.PROCESSING,
								attempts: 1,
								leaseToken,
								leaseExpiresAt
							}
						],
						skipDuplicates: true
					}
				);
				if (created.count === 1) return true;
				const current = await transaction.telegramUpdateReceipt.findUnique(
					{
						where: { botKind_updateId: { botKind, updateId } }
					}
				);
				if (!current || current.payloadHash !== payloadHash) {
					throw new BadRequestException(
						'Telegram update receipt mismatch'
					);
				}
				if (current.status === WebhookReceiptStatus.DELIVERED)
					return false;
				const reclaimed =
					await transaction.telegramUpdateReceipt.updateMany({
						where: {
							botKind,
							updateId,
							payloadHash,
							OR: [
								{ status: WebhookReceiptStatus.FAILED },
								{
									status: WebhookReceiptStatus.PROCESSING,
									leaseExpiresAt: { lte: now }
								}
							]
						},
						data: {
							status: WebhookReceiptStatus.PROCESSING,
							attempts: { increment: 1 },
							leaseToken,
							leaseExpiresAt,
							lastError: null
						}
					});
				if (reclaimed.count === 0) {
					throw new BadRequestException(
						'Telegram update is already processing'
					);
				}
				return true;
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
		);
		if (!claim) return true;
		try {
			await handle();
			const delivered = await this.prisma.telegramUpdateReceipt.updateMany(
				{
					where: {
						botKind,
						updateId,
						leaseToken,
						status: WebhookReceiptStatus.PROCESSING
					},
					data: {
						status: WebhookReceiptStatus.DELIVERED,
						deliveredAt: new Date(),
						leaseToken: null,
						leaseExpiresAt: null,
						lastError: null
					}
				}
			);
			if (delivered.count !== 1) {
				throw new Error('Telegram update lease was lost');
			}
			return true;
		} catch (error) {
			await this.prisma.telegramUpdateReceipt.updateMany({
				where: { botKind, updateId, leaseToken },
				data: {
					status: WebhookReceiptStatus.FAILED,
					leaseToken: null,
					leaseExpiresAt: null,
					lastError: this.errorText(error)
				}
			});
			throw error;
		}
	}

	private async sendMessage(
		kind: 'INFO',
		chatId: string | number,
		text: string,
		replyMarkup?: Record<string, unknown>
	) {
		await this.telegramApi(this.botToken(kind, true), 'sendMessage', {
			chat_id: chatId,
			text,
			...(replyMarkup ? { reply_markup: replyMarkup } : {})
		});
	}

	private async telegramApi(
		token: string,
		method: string,
		body?: Record<string, unknown>
	): Promise<TelegramApiEnvelope> {
		const apiBaseUrl = this.telegramApiBaseUrl();
		let response: Response;
		try {
			response = await fetch(`${apiBaseUrl}/bot${token}/${method}`, {
				method: body ? 'POST' : 'GET',
				headers: body ? { 'content-type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(10_000)
			});
		} catch {
			throw new BadRequestException('Telegram API is unavailable');
		}
		let value: unknown;
		try {
			value = await response.json();
		} catch {
			throw new BadRequestException('Telegram API returned invalid JSON');
		}
		if (!this.isRecord(value)) {
			throw new BadRequestException('Telegram API returned invalid JSON');
		}
		const envelope = value as TelegramApiEnvelope;
		if (!response.ok || envelope.ok !== true) {
			throw new BadRequestException(
				typeof envelope.description === 'string'
					? envelope.description.slice(0, 500)
					: 'Telegram API request failed'
			);
		}
		return envelope;
	}

	private telegramApiBaseUrl(): string {
		const mode = this.config.get<string>('MODE')?.trim().toLowerCase();
		const configured = this.config
			.get<string>('TELEGRAM_API_BASE_URL')
			?.trim();
		if (!configured) {
			if (mode === 'production') {
				throw new BadRequestException(
					'Telegram API configuration is invalid'
				);
			}
			return 'https://api.telegram.org';
		}

		let url: URL;
		try {
			url = new URL(configured);
		} catch {
			throw new BadRequestException(
				'Telegram API configuration is invalid'
			);
		}
		const loopbackHost = ['127.0.0.1', 'localhost', '[::1]'].includes(
			url.hostname
		);
		const directTelegramApi =
			url.protocol === 'https:' &&
			url.hostname === 'api.telegram.org' &&
			url.port === '' &&
			url.pathname === '/';
		const productionReverseProxy =
			url.protocol === 'https:' &&
			url.hostname === 'telegram.aerocrm.space' &&
			url.port === '' &&
			url.pathname === '/telegram-api';
		const loopbackTestApi =
			mode !== 'production' && url.protocol === 'http:' && loopbackHost;
		if (
			!(mode === 'production'
				? productionReverseProxy
				: directTelegramApi ||
					productionReverseProxy ||
					loopbackTestApi) ||
			url.username !== '' ||
			url.password !== '' ||
			url.search !== '' ||
			url.hash !== ''
		) {
			throw new BadRequestException(
				'Telegram API configuration is invalid'
			);
		}
		return url.toString().replace(/\/+$/, '');
	}

	private webhookFailure(
		kind: TelegramWebhookKind,
		token: string,
		username: string,
		expectedWebhookUrl: string | null,
		error: string
	) {
		const config = this.webhookConfig(kind);
		return {
			bot: config.bot,
			title: config.title,
			configured: Boolean(token),
			ok: false,
			expectedWebhookUrl,
			webhookUrl: null,
			webhookMatchesExpected: false,
			pendingUpdateCount: null,
			lastErrorAt: null,
			lastErrorMessage: null,
			allowedUpdates: null,
			secretConfigured: Boolean(this.webhookSecret(kind)),
			configuredUsername: username || null,
			actualUsername: null,
			usernameMatchesConfigured: null,
			error
		};
	}

	private webhookConfig(kind: TelegramWebhookKind) {
		return {
			bot: 'info' as const,
			title: 'Info_bot',
			allowedUpdates: ['message'],
			notConfiguredError: 'Telegram notification bot is not configured'
		};
	}

	private startArgument(text?: string): string | null {
		if (!text?.startsWith('/start')) return null;
		const value = text.split(/\s+/, 2)[1]?.trim();
		return value && value.length <= 255 ? value : null;
	}

	private webhookUrl(kind: TelegramWebhookKind): string {
		const raw =
			this.config.get<string>('TELEGRAM_WEBHOOK_HOST')?.trim() || '';
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw new Error(
				'TELEGRAM_WEBHOOK_HOST must be a valid HTTPS origin'
			);
		}
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== '/'
		) {
			throw new Error(
				'TELEGRAM_WEBHOOK_HOST must be a valid HTTPS origin'
			);
		}
		return `${url.toString().replace(/\/$/, '')}/api/v1/telegram-bot/webhook`;
	}

	private botToken(kind: TelegramWebhookKind, required = false): string {
		const value =
			this.config.get<string>(`TELEGRAM_${kind}_BOT_TOKEN`)?.trim() || '';
		if (required && !value) {
			throw new BadRequestException(
				'Telegram notification bot not configured'
			);
		}
		return value;
	}

	private botUsername(
		kind: TelegramWebhookKind,
		required = false
	): string {
		const value =
			this.config
				.get<string>(`TELEGRAM_${kind}_BOT_USERNAME`)
				?.trim()
				.replace(/^@/, '') || '';
		if (required && !value) {
			throw new BadRequestException(
				'Telegram notification bot not configured'
			);
		}
		return value;
	}

	private webhookSecret(
		kind: TelegramWebhookKind,
		required = false
	): string {
		const value =
			this.config
				.get<string>(`TELEGRAM_${kind}_BOT_WEBHOOK_SECRET`)
				?.trim() || '';
		if (required && value.length < 16) {
			throw new BadRequestException(
				'Telegram webhook secret is not configured'
			);
		}
		return value;
	}

	private assertWebhookSecret(
		kind: TelegramWebhookKind,
		supplied?: string
	) {
		const expected = this.webhookSecret(kind, true);
		if (!supplied || !safeEqual(expected, supplied)) {
			throw new UnauthorizedException(
				'Telegram notification webhook secret invalid'
			);
		}
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return (
			Boolean(value) && typeof value === 'object' && !Array.isArray(value)
		);
	}

	private string(value: unknown): string | undefined {
		return typeof value === 'string' ? value : undefined;
	}

	private number(value: unknown): number | undefined {
		return typeof value === 'number' && Number.isFinite(value)
			? value
			: undefined;
	}

	private errorText(error: unknown): string {
		return (error instanceof Error ? error.message : String(error)).slice(
			0,
			2_000
		);
	}
}
