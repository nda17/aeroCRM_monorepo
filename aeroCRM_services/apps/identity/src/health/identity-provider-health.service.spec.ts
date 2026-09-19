import type { ConfigService } from '@nestjs/config';
import { IdentityInternalController } from '../internal/internal.controller';
import { IdentityProviderHealthService } from './identity-provider-health.service';

const createService = (options: {
	turnstileEnvironment?: string;
	turnstileDatabase?: boolean;
	turnstileSecret?: string;
	emailConfigured?: boolean;
	smsConfigured?: boolean;
	verifyEmail?: jest.Mock;
	verifySms?: jest.Mock;
}) => {
	const values: Record<string, string | undefined> = {
		TURNSTILE_ENABLED: options.turnstileEnvironment,
		TURNSTILE_SECRET_KEY: options.turnstileSecret,
		TURNSTILE_EXPECTED_HOSTNAME: 'aerocrm.space'
	};
	const settings = {
		get: jest.fn().mockResolvedValue({
			turnstileEnabled: options.turnstileDatabase ?? true
		})
	};
	const transport = {
		isEmailConfigured: jest.fn(() => options.emailConfigured ?? true),
		isSmsConfigured: jest.fn(() => options.smsConfigured ?? true),
		verifyEmailTransport:
			options.verifyEmail ?? jest.fn().mockResolvedValue(undefined),
		verifySmsTransport:
			options.verifySms ?? jest.fn().mockResolvedValue(undefined)
	};
	const service = new IdentityProviderHealthService(
		{
			get: jest.fn((key: string) => values[key])
		} as unknown as ConfigService,
		settings as any,
		transport as any
	);
	return { service, settings, transport };
};

describe('IdentityProviderHealthService', () => {
	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it('returns three fixed safe provider checks without exposing credentials or errors', async () => {
		const secretError = 'provider leaked secret value';
		const { service } = createService({
			turnstileEnvironment: 'true',
			turnstileSecret: 'configured-secret',
			verifyEmail: jest.fn().mockRejectedValue(new Error(secretError))
		});

		const result = await service.providerHealth();

		expect(result).toEqual({
			service: 'identity',
			checks: [
				expect.objectContaining({
					id: 'smtp',
					status: 'down',
					message: 'Проверка подключения не пройдена'
				}),
				expect.objectContaining({
					id: 'smsaero',
					status: 'ok',
					message: 'Подключение работает'
				}),
				{
					id: 'turnstile',
					title: 'Cloudflare Turnstile',
					status: 'ok',
					message: 'Ключ и hostname настроены'
				}
			]
		});
		expect(JSON.stringify(result)).not.toContain(secretError);
		expect(JSON.stringify(result)).not.toContain('configured-secret');
	});

	it('uses both environment and database settings for Turnstile state', async () => {
		const environmentDisabled = createService({
			turnstileEnvironment: 'false',
			turnstileDatabase: true,
			emailConfigured: false,
			smsConfigured: false
		});
		const databaseDisabled = createService({
			turnstileEnvironment: 'true',
			turnstileDatabase: false,
			turnstileSecret: 'configured'
		});

		await expect(
			environmentDisabled.service.providerHealth()
		).resolves.toEqual(
			expect.objectContaining({
				checks: expect.arrayContaining([
					expect.objectContaining({
						id: 'turnstile',
						status: 'disabled',
						message: 'Turnstile отключён конфигурацией'
					})
				])
			})
		);
		await expect(
			databaseDisabled.service.providerHealth()
		).resolves.toEqual(
			expect.objectContaining({
				checks: expect.arrayContaining([
					expect.objectContaining({
						id: 'turnstile',
						status: 'disabled',
						message: 'Turnstile отключён настройками'
					})
				])
			})
		);
	});

	it('bounds a stalled provider probe', async () => {
		jest.useFakeTimers();
		const { service } = createService({
			turnstileEnvironment: 'false',
			verifyEmail: jest.fn(() => new Promise<void>(() => undefined))
		});

		const resultPromise = service.providerHealth();
		await Promise.resolve();
		await jest.advanceTimersByTimeAsync(3_001);

		await expect(resultPromise).resolves.toEqual(
			expect.objectContaining({
				checks: expect.arrayContaining([
					expect.objectContaining({ id: 'smtp', status: 'down' })
				])
			})
		);
	});

	it('returns a fixed down check when auth settings cannot be loaded', async () => {
		const { service, settings } = createService({
			turnstileEnvironment: 'true',
			turnstileSecret: 'configured'
		});
		settings.get.mockRejectedValue(new Error('database secret details'));

		const result = await service.providerHealth();

		expect(result.checks).toContainEqual({
			id: 'turnstile',
			title: 'Cloudflare Turnstile',
			status: 'down',
			message: 'Настройки Turnstile недоступны'
		});
		expect(JSON.stringify(result)).not.toContain(
			'database secret details'
		);
	});

	it('keeps the admin health endpoint scoped to Operations and delegates to the API provider', async () => {
		const providerHealth = jest.fn().mockResolvedValue({
			service: 'identity',
			checks: []
		});
		const controller = new IdentityInternalController(
			{} as any,
			{ providerHealth } as any
		);

		await expect(controller.adminHealth()).resolves.toEqual({
			service: 'identity',
			checks: []
		});
		expect(
			Reflect.getMetadata(
				'identity.internal.services',
				IdentityInternalController.prototype.adminHealth
			)
		).toEqual(['operations']);
	});
});
