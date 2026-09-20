import { ConfigService } from '@nestjs/config';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { VerificationChallengePurpose, VerificationChallengeType } from '@prisma/identity-client';
import type { Request } from 'express';
import { TelegramAdminController } from './telegram.controller';
import { TelegramService } from './telegram.service';

const NOW = new Date('2026-08-14T10:00:00.000Z');

function challenge(overrides: Record<string, any> = {}) {
	return {
		id: 'challenge',
		userId: null,
		type: VerificationChallengeType.TELEGRAM,
		purpose: VerificationChallengePurpose.LOGIN,
		value: 'request-id',
		passwordHash: null,
		codeHash: 'hash',
		attempts: 0,
		expiresAt: new Date(Date.now() + 60_000),
		lastSentAt: NOW,
		telegramUserId: '777',
		telegramChatId: null,
		telegramUsername: 'telegram-user',
		telegramFirstName: 'Telegram',
		telegramLastName: 'User',
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

function createService(
	challengeValue: Record<string, any>,
	config: Record<string, string> = {}
) {
	const configValues = Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined
		)
	);
	Object.assign(configValues, config);
	for (const key of ['MODE', 'TELEGRAM_API_BASE_URL']) {
		if (!Object.prototype.hasOwnProperty.call(config, key)) {
			delete configValues[key];
		}
	}
	const tx = {
		verificationChallenge: {
			findUnique: jest.fn().mockResolvedValue(challengeValue),
			delete: jest.fn(),
			update: jest.fn()
		},
		authIdentity: { findUnique: jest.fn() },
		user: { create: jest.fn(), findFirst: jest.fn() }
	};
	const prisma = {
		verificationChallenge: {
			deleteMany: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			findFirst: jest.fn()
		},
		$transaction: jest.fn(
			(callback: (transaction: typeof tx) => unknown) => callback(tx)
		)
	};
	const events = {
		emitUserChanged: jest.fn(),
		emitBillingRequest: jest.fn(),
		emitAudit: jest.fn()
	};
	const service = new TelegramService(
		{ get: (key: string) => configValues[key] } as ConfigService,
		prisma as any,
		events as any
	);
	return {
		service,
		prisma,
		tx,
		events
	};
}

describe('Identity Telegram API routing', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('routes bot calls through the pinned HTTPS reverse proxy', async () => {
		const value = createService(challenge(), {
			MODE: 'production',
			TELEGRAM_API_BASE_URL: 'https://telegram.aerocrm.space/telegram-api'
		});
		const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			json: jest.fn().mockResolvedValue({ ok: true })
		} as unknown as Response);

		await (value.service as any).telegramApi('identity-token', 'getMe');

		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://telegram.aerocrm.space/telegram-api/botidentity-token/getMe'
		);
	});

	it.each([
		undefined,
		'https://api.telegram.org',
		'https://api.telegram.org:8443',
		'https://telegram.aerocrm.space/telegram-api/',
		'https://telegram.aerocrm.space/telegram-api?target=other',
		'https://telegram.aerocrm.space/telegram-api#fragment'
	])('rejects a direct production endpoint: %s', async apiBaseUrl => {
		const value = createService(challenge(), {
			MODE: 'production',
			...(apiBaseUrl ? { TELEGRAM_API_BASE_URL: apiBaseUrl } : {})
		});

		await expect(
			(value.service as any).telegramApi('identity-token', 'getMe')
		).rejects.toThrow('Telegram API configuration is invalid');
	});
});

describe('Telegram Info admin webhook contract', () => {
	const environmentKeys = [
		'TELEGRAM_INFO_BOT_TOKEN',
		'TELEGRAM_INFO_BOT_USERNAME',
		'TELEGRAM_INFO_BOT_WEBHOOK_SECRET',
		'TELEGRAM_WEBHOOK_HOST'
	] as const;
	let previousEnvironment: Record<string, string | undefined>;

	beforeEach(() => {
		previousEnvironment = Object.fromEntries(
			environmentKeys.map(key => [key, process.env[key]])
		);
		process.env.TELEGRAM_INFO_BOT_TOKEN = 'configured-info-token';
		process.env.TELEGRAM_INFO_BOT_USERNAME = '@aerocrm_info_bot';
		process.env.TELEGRAM_INFO_BOT_WEBHOOK_SECRET =
			'configured-info-webhook-secret';
		process.env.TELEGRAM_WEBHOOK_HOST = 'https://telegram.aerocrm.space';
	});

	afterEach(() => {
		jest.restoreAllMocks();
		for (const key of environmentKeys) {
			const value = previousEnvironment[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it.each(['group', 'supergroup'])(
		'ignores Info_bot messages from %s chats without side effects',
		async chatType => {
			const fetchMock = jest.spyOn(global, 'fetch');
			const value = createService(challenge());

			await expect(
				value.service.handleInfoWebhook(
					{
						update_id: 101,
						message: {
							message_id: 202,
							text: 'Сообщение в General',
							chat: { id: -1001234567890, type: chatType },
							from: { id: 303, username: 'admin' }
						}
					},
					'configured-info-webhook-secret'
				)
			).resolves.toBe(true);

			expect(value.prisma.$transaction).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('reads Info_bot status without changing the Telegram webhook', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockImplementation(async input => {
				const url = String(input);
				const result = url.endsWith('/getWebhookInfo')
					? {
							url: 'https://telegram.aerocrm.space/api/v1/telegram-bot/webhook',
							pending_update_count: 0,
							allowed_updates: ['message']
						}
					: { username: 'aerocrm_info_bot' };
				return new Response(JSON.stringify({ ok: true, result }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			});
		const value = createService(challenge());

		await expect(value.service.infoWebhookStatus()).resolves.toEqual(
			expect.objectContaining({
				bot: 'info',
				title: 'Info_bot',
				configured: true,
				ok: true,
				expectedWebhookUrl:
					'https://telegram.aerocrm.space/api/v1/telegram-bot/webhook',
				webhookMatchesExpected: true,
				secretConfigured: true,
				configuredUsername: 'aerocrm_info_bot',
				actualUsername: 'aerocrm_info_bot',
				usernameMatchesConfigured: true,
				allowedUpdates: ['message']
			})
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(
			fetchMock.mock.calls.some(([input]) =>
				String(input).endsWith('/setWebhook')
			)
		).toBe(false);
	});

	it('reinstalls Info_bot through Identity and emits the audit event', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
			async () =>
				new Response(JSON.stringify({ ok: true, result: {} }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);
		const value = createService(challenge());
		const request = {
			headers: {},
			header: jest.fn(),
			get: jest.fn(),
			ip: '127.0.0.1'
		} as unknown as Request;

		await expect(
			value.service.reinstallInfoWebhook('admin-id', request)
		).resolves.toEqual(
			expect.objectContaining({
				bot: 'info',
				title: 'Info_bot',
				webhookUrl: 'https://telegram.aerocrm.space/api/v1/telegram-bot/webhook',
				dropPendingUpdates: false,
				allowedUpdates: ['message'],
				secretConfigured: true
			})
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toContain('/setWebhook');
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
			url: 'https://telegram.aerocrm.space/api/v1/telegram-bot/webhook',
			drop_pending_updates: false,
			max_connections: 40,
			allowed_updates: ['message'],
			secret_token: 'configured-info-webhook-secret'
		});
		expect(value.events.emitAudit).toHaveBeenCalledWith(
			value.tx,
			expect.objectContaining({
				actorId: 'admin-id',
				entityId: 'info',
				entityLabel: 'Info_bot',
				description: 'Переустановлен webhook Info_bot',
				metadata: {
					bot: 'info',
					title: 'Info_bot',
					dropPendingUpdates: false,
					allowedUpdates: ['message'],
					secretConfigured: true,
					installedAt: expect.stringMatching(/Z$/)
				}
			})
		);
	});
});

describe('Telegram Info admin route contract', () => {
	it('keeps Info_bot admin operations under the routed Identity prefix', () => {
		expect(
			Reflect.getMetadata(PATH_METADATA, TelegramAdminController)
		).toBe('telegram-info/admin');
		expect(
			Reflect.getMetadata(
				PATH_METADATA,
				TelegramAdminController.prototype.infoStatus
			)
		).toBe('info-webhook/status');
		expect(
			Reflect.getMetadata(
				METHOD_METADATA,
				TelegramAdminController.prototype.infoStatus
			)
		).toBe(RequestMethod.GET);
		expect(
			Reflect.getMetadata(
				PATH_METADATA,
				TelegramAdminController.prototype.reinstallInfo
			)
		).toBe('info-webhook/reinstall');
		expect(
			Reflect.getMetadata(
				METHOD_METADATA,
				TelegramAdminController.prototype.reinstallInfo
			)
		).toBe(RequestMethod.POST);
	});
});
