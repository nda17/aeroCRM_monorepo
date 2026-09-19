import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthSettingsService } from '../auth/auth-settings.service';
import { VerificationTransportService } from '../transports/verification-transport.service';

type ProviderHealthStatus = 'ok' | 'warning' | 'down' | 'disabled';

export type IdentityProviderHealthCheck = {
	id: 'smtp' | 'smsaero' | 'turnstile';
	title: string;
	status: ProviderHealthStatus;
	message: string;
	latencyMs?: number;
};

const PROVIDER_PROBE_TIMEOUT_MS = 3_000;

@Injectable()
export class IdentityProviderHealthService {
	constructor(
		private readonly config: ConfigService,
		private readonly settings: AuthSettingsService,
		private readonly transport: VerificationTransportService
	) {}

	async providerHealth(): Promise<{
		service: 'identity';
		checks: IdentityProviderHealthCheck[];
	}> {
		const authSettings = await this.settings.get().catch(() => null);
		const checks = await Promise.all([
			this.checkSmtp(),
			this.checkSmsAero(),
			this.checkTurnstile(authSettings?.turnstileEnabled ?? null)
		]);
		return { service: 'identity', checks };
	}

	private checkSmtp(): Promise<IdentityProviderHealthCheck> {
		if (!this.transport.isEmailConfigured()) {
			return Promise.resolve({
				id: 'smtp',
				title: 'Email SMTP',
				status: 'warning',
				message: 'SMTP не настроен'
			});
		}
		return this.probe('smtp', 'Email SMTP', () =>
			this.transport.verifyEmailTransport()
		);
	}

	private checkSmsAero(): Promise<IdentityProviderHealthCheck> {
		if (!this.transport.isSmsConfigured()) {
			return Promise.resolve({
				id: 'smsaero',
				title: 'SMS Aero',
				status: 'warning',
				message: 'SMS Aero не настроен'
			});
		}
		return this.probe('smsaero', 'SMS Aero', () =>
			this.transport.verifySmsTransport()
		);
	}

	private async checkTurnstile(
		databaseEnabled: boolean | null
	): Promise<IdentityProviderHealthCheck> {
		if (databaseEnabled === null) {
			return {
				id: 'turnstile',
				title: 'Cloudflare Turnstile',
				status: 'down',
				message: 'Настройки Turnstile недоступны'
			};
		}
		const environmentEnabled =
			this.config.get<string>('TURNSTILE_ENABLED') === 'true';
		if (!environmentEnabled) {
			return {
				id: 'turnstile',
				title: 'Cloudflare Turnstile',
				status: 'disabled',
				message: 'Turnstile отключён конфигурацией'
			};
		}
		if (!databaseEnabled) {
			return {
				id: 'turnstile',
				title: 'Cloudflare Turnstile',
				status: 'disabled',
				message: 'Turnstile отключён настройками'
			};
		}
		const secret = this.config.get<string>('TURNSTILE_SECRET_KEY')?.trim() || '';
		const hostname = this.config.get<string>('TURNSTILE_EXPECTED_HOSTNAME')?.trim() || '';
		return {
			id: 'turnstile',
			title: 'Cloudflare Turnstile',
			status: secret && hostname ? 'ok' : 'warning',
			message: secret && hostname ? 'Ключ и hostname настроены' : 'Ключ или hostname не настроен'
		};
	}

	private async probe(
		id: 'smtp' | 'smsaero',
		title: string,
		operation: () => Promise<void>
	): Promise<IdentityProviderHealthCheck> {
		const startedAt = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				operation(),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error('provider health timeout')),
						PROVIDER_PROBE_TIMEOUT_MS
					);
				})
			]);
			return {
				id,
				title,
				status: 'ok',
				message: 'Подключение работает',
				latencyMs: Date.now() - startedAt
			};
		} catch {
			return {
				id,
				title,
				status: 'down',
				message: 'Проверка подключения не пройдена',
				latencyMs: Date.now() - startedAt
			};
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}
