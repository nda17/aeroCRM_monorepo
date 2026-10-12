import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config';

const telegramRoute = {
	id: 'telegram-business-webhook',
	pathPrefix: '/api/v1/telegram-bot/business-webhook',
	upstreamUrl: 'http://127.0.0.1:5300',
	authPolicy: 'telegram-webhook',
	timeoutMs: 15000
};

const environment = (routes: unknown[]) => ({
	GATEWAY_ROUTES_JSON: JSON.stringify(routes),
	JWT_JWKS_URL: 'https://identity.example.test/api/v1/auth/.well-known/jwks.json',
	JWT_ISSUER: 'https://identity.example.test',
	JWT_AUDIENCE: 'aerocrm',
	CORS_ALLOWED_ORIGINS: 'https://app.example.test'
});

describe('Telegram Business Gateway route policy', () => {
	it('loads the exact webhook path with its dedicated auth policy', () => {
		const config = loadConfig(environment([telegramRoute]));
		assert.equal(config.routes.length, 1);
		assert.deepEqual(config.routes[0], {
			...telegramRoute,
			upstreamUrl: new URL('http://127.0.0.1:5300/')
		});
	});

	it('rejects moving the webhook credential policy to another route', () => {
		assert.throws(() => loadConfig(environment([{
			...telegramRoute,
			pathPrefix: '/api/v1/identity-telegram/webhook'
		}])), /telegram-webhook policy is restricted/);
	});
});
