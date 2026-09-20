import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { OAuthService, workspaceReturnPath } from './oauth.service';

const response = () =>
	({
		cookie: jest.fn(),
		clearCookie: jest.fn(),
		redirect: jest.fn((url: string) => url)
	}) as unknown as Response;

const createService = () => {
	const authorization = {
		stateHash: '',
		provider: 'GOOGLE',
		codeVerifier: 'verifier',
		referrerId: null,
		clientKind: 'workspace',
		returnPath: '/deals?stage=new',
		consumedAt: null,
		expiresAt: new Date(Date.now() + 60_000)
	};
	const transaction = {
		oAuthAuthorization: {
			findUnique: jest.fn().mockResolvedValue(authorization),
			updateMany: jest.fn().mockResolvedValue({ count: 1 })
		}
	};
	const prisma = {
		oAuthAuthorization: { create: jest.fn() },
		$transaction: jest.fn(callback => callback(transaction))
	};
	const auth = { startSession: jest.fn().mockResolvedValue({ refreshToken: 'private' }) };
	const refresh = { add: jest.fn(), remove: jest.fn() };
	const service = new OAuthService(
		new ConfigService({
			TURNSTILE_CLIENT_URL: 'https://aerocrm.space',
			OAUTH_WORKSPACE_CLIENT_URL: 'https://workspace.aerocrm.space',
			GOOGLE_CLIENT_ID: 'google-client',
			GOOGLE_CALLBACK_URL: 'https://api.aerocrm.space/api/v1/auth/google/redirect'
		}),
		prisma as never,
		{} as never,
		{ assertProviderEnabled: jest.fn() } as never,
		auth as never,
		refresh as never,
		{} as never
	);
	return { service, authorization, transaction, prisma, auth, refresh };
};

describe('workspace OAuth state binding', () => {
	it('stores the client and safe return path with the state', async () => {
		const { service, prisma } = createService();
		const target = response();

		await service.start('google', undefined, target, 'workspace', '/deals?stage=new');

		expect(prisma.oAuthAuthorization.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				clientKind: 'workspace',
				returnPath: '/deals?stage=new'
			})
		});
		expect(target.redirect).toHaveBeenCalledWith(
			expect.stringContaining('https://accounts.google.com/')
		);
	});

	it('returns a verified provider cancellation to workspace login without a session', async () => {
		const { service, auth, refresh } = createService();
		const target = response();
		await service.callback(
			'google',
			{ cookies: { identityOAuthState_google: 'state' } } as unknown as Request,
			target,
			{ state: 'state', error: 'access_denied' }
		);

		expect(target.redirect).toHaveBeenCalledWith(
			'https://workspace.aerocrm.space/login?error=social_auth_failed'
		);
		expect(auth.startSession).not.toHaveBeenCalled();
		expect(refresh.add).not.toHaveBeenCalled();
	});

	it('routes success by consumed state and never exposes the refresh token in the URL', async () => {
		const { service, auth, refresh } = createService();
		jest.spyOn(service as never, 'profile').mockResolvedValue({
			providerId: 'provider-id',
			email: 'user@example.com'
		} as never);
		jest.spyOn(service as never, 'upsertUser').mockResolvedValue({ id: 'user' } as never);
		const target = response();
		await service.callback(
			'google',
			{ cookies: { identityOAuthState_google: 'state' } } as unknown as Request,
			target,
			{ state: 'state', code: 'provider-code' }
		);

		expect(auth.startSession).toHaveBeenCalledTimes(1);
		expect(refresh.add).toHaveBeenCalledWith(target, 'private');
		expect(target.redirect).toHaveBeenCalledWith(
			'https://workspace.aerocrm.space/social-auth?returnPath=%2Fdeals%3Fstage%3Dnew'
		);
	});

	it('does not trust callbacks with a wrong cookie, provider, expired or replayed state', async () => {
		const { service, authorization, transaction, auth } = createService();
		const invalidCookie = response();
		await service.callback('google', { cookies: {} } as Request, invalidCookie, {
			state: 'state',
			code: 'provider-code'
		});
		expect(invalidCookie.redirect).toHaveBeenCalledWith(
			'https://aerocrm.space/login?error=social_auth_failed'
		);
		expect(transaction.oAuthAuthorization.findUnique).not.toHaveBeenCalled();

		for (const change of [
			{ provider: 'YANDEX' },
			{ consumedAt: new Date() },
			{ expiresAt: new Date(Date.now() - 1_000) }
		]) {
			Object.assign(authorization, change);
			const target = response();
			await service.callback(
				'google',
				{ cookies: { identityOAuthState_google: 'state' } } as unknown as Request,
				target,
				{ state: 'state', code: 'provider-code' }
			);
			expect(target.redirect).toHaveBeenCalledWith(
				'https://aerocrm.space/login?error=social_auth_failed'
			);
			Object.assign(authorization, {
				provider: 'GOOGLE',
				consumedAt: null,
				expiresAt: new Date(Date.now() + 60_000)
			});
		}
		expect(auth.startSession).not.toHaveBeenCalled();
	});

	it.each(['//evil.example', '/login', '/inbox/../login', '/inbox\\evil', '/inbox#fragment'])
		('rejects unsafe return path %s', value => {
			expect(() => workspaceReturnPath(value)).toThrow('invalid');
		});
});
