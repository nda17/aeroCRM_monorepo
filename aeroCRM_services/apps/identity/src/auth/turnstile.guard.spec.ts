import {
	BadRequestException,
	ExecutionContext,
	ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { TurnstileGuard } from './turnstile.guard';

describe('Turnstile outage classification', () => {
	const originalFetch = global.fetch;
	afterEach(() => {
		global.fetch = originalFetch;
	});
	function guard() {
		return new TurnstileGuard(
			new ConfigService({
				TURNSTILE_ENABLED: 'true',
				TURNSTILE_SECRET_KEY: 'synthetic-only',
				TURNSTILE_EXPECTED_HOSTNAME: 'aerocrm.space'
			}),
			{ getAllAndOverride: () => 'login' } as unknown as Reflector,
			{ get: async () => ({ turnstileEnabled: true }) } as never
		);
	}
	const context = {
		getHandler: () => null,
		getClass: () => null,
		switchToHttp: () => ({
			getRequest: () => ({ header: () => 'synthetic-token' })
		})
	} as unknown as ExecutionContext;

	it.each(['network', 'http', 'invalid-json', 'null-json'])(
		'classifies %s as explicit unavailable, retaining status/message',
		async kind => {
			global.fetch = jest.fn(async () => {
				if (kind === 'network') throw new Error('private provider detail');
				return kind === 'http'
					? new Response('', { status: 503 })
					: new Response(kind === 'invalid-json' ? '{' : 'null');
			}) as typeof fetch;
			try {
				await guard().canActivate(context);
				throw new Error('expected rejection');
			} catch (error) {
				expect(error).toBeInstanceOf(ServiceUnavailableException);
				expect(
					(error as ServiceUnavailableException).getResponse()
				).toEqual({
					code: 'turnstile_unavailable',
					message: 'Не удалось проверить Turnstile. Попробуйте позже.'
				});
			}
		}
	);

	it.each([
		{ success: false },
		{ success: true, action: 'login', hostname: 'evil.example' },
		{ success: true, action: 'register', hostname: 'aerocrm.space' }
	])('does not turn a rejected token into outage: %j', async body => {
		global.fetch = jest.fn(async () =>
			Response.json(body)
		) as typeof fetch;
		await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
			BadRequestException
		);
	});

	it('accepts a successful token for the expected action and hostname', async () => {
		global.fetch = jest.fn(async () =>
			Response.json({ success: true, action: 'login', hostname: 'aerocrm.space' })
		) as typeof fetch;
		await expect(guard().canActivate(context)).resolves.toBe(true);
	});
});
