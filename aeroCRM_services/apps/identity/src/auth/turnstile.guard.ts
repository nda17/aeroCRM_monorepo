import {
	BadRequestException,
	CanActivate,
	ExecutionContext,
	Injectable,
	ServiceUnavailableException,
	SetMetadata
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthSettingsService } from './auth-settings.service';

const ACTION = 'turnstile_action';
export const TurnstileAction = (action: string) =>
	SetMetadata(ACTION, action);

@Injectable()
export class TurnstileGuard implements CanActivate {
	private readonly enabled: boolean;
	private readonly secret: string;
	private readonly hostname: string;

	constructor(
		config: ConfigService,
		private readonly reflector: Reflector,
		private readonly settings: AuthSettingsService
	) {
		this.enabled = config.get<string>('TURNSTILE_ENABLED') === 'true';
		this.secret = config.get<string>('TURNSTILE_SECRET_KEY')?.trim() || '';
		this.hostname = config.get<string>('TURNSTILE_EXPECTED_HOSTNAME')?.trim().toLowerCase() || '';
		if (this.enabled && (!this.secret || !this.hostname)) {
			throw new Error('Turnstile configuration is invalid');
		}
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const action = this.reflector.getAllAndOverride<string>(ACTION, [
			context.getHandler(),
			context.getClass()
		]);
		if (!action) return true;
		const settings = await this.settings.get();
		if (!this.enabled || !settings.turnstileEnabled) return true;
		const request = context.switchToHttp().getRequest<Request>();
		const candidate = request.header('turnstile') || '';
		if (!candidate || candidate.length > 2048)
			throw new BadRequestException('Капча не была пройдена.');
		let response: Response;
		try {
			const body = new URLSearchParams({
				secret: this.secret,
				response: candidate
			});
			response = await fetch(
				'https://challenges.cloudflare.com/turnstile/v0/siteverify',
				{
					method: 'POST',
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
					body,
					signal: AbortSignal.timeout(10_000)
				}
			);
		} catch {
			throw turnstileUnavailable();
		}
		if (!response.ok) {
			throw turnstileUnavailable();
		}
		let result: {
			success?: boolean;
			action?: string;
			hostname?: string;
		};
		try {
			const body: unknown = await response.json();
			if (!body || typeof body !== 'object' || Array.isArray(body))
				throw new Error();
			result = body;
		} catch {
			throw turnstileUnavailable();
		}
		if (
			result.success !== true ||
			result.action !== action ||
			result.hostname?.toLowerCase() !== this.hostname
		) {
			throw new BadRequestException(
				'Проверка Turnstile не пройдена. Попробуйте ещё раз.'
			);
		}
		return true;
	}
}

function turnstileUnavailable() {
	return new ServiceUnavailableException({
		code: 'turnstile_unavailable',
		message: 'Не удалось проверить Turnstile. Попробуйте позже.'
	});
}
