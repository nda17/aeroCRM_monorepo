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

export const expectedTurnstileHostnames = (config: ConfigService): Set<string> => {
	const configured = config.get<string>('TURNSTILE_EXPECTED_HOSTNAMES');
	const raw =
		configured === undefined
			? config.get<string>('TURNSTILE_EXPECTED_HOSTNAME') || ''
			: configured;
	if (!raw.trim()) return new Set();
	const hosts = raw.split(',').map(value => value.trim().toLowerCase());
	if (hosts.some(host => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host))) {
		throw new Error('Turnstile expected hostnames are invalid');
	}
	return new Set(hosts);
};

@Injectable()
export class TurnstileGuard implements CanActivate {
	private readonly enabled: boolean;
	private readonly secret: string;
	private readonly hostnames: Set<string>;

	constructor(
		config: ConfigService,
		private readonly reflector: Reflector,
		private readonly settings: AuthSettingsService
	) {
		this.enabled = config.get<string>('TURNSTILE_ENABLED') === 'true';
		this.secret = config.get<string>('TURNSTILE_SECRET_KEY')?.trim() || '';
		this.hostnames = expectedTurnstileHostnames(config);
		if (this.enabled && (!this.secret || this.hostnames.size === 0)) {
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
			!this.hostnames.has(result.hostname?.toLowerCase() || '')
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
