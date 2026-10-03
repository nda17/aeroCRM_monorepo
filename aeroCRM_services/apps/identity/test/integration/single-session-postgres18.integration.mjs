import assert from 'node:assert/strict';
import {
	randomUUID,
	generateKeyPairSync,
	createHash,
	randomBytes
} from 'node:crypto';
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
load('reflect-metadata');
const { PrismaClient } = load('@prisma/identity-client');
const { hash } = load('bcryptjs');
const { ConfigService } = load('@nestjs/config');
const { JwtService } = load('@nestjs/jwt');
const { AuthService } = load('../../dist/src/auth/auth.service.js');
const { AccessJwtService } = load(
	'../../dist/src/auth/access-jwt.service.js'
);
const { RefreshTokenService } = load(
	'../../dist/src/auth/refresh-token.service.js'
);
const { IdentityAuthGuard } = load('../../dist/src/auth/auth.guard.js');
const { IdentityInternalService } = load(
	'../../dist/src/internal/internal.service.js'
);
const { LoginOtpService } = load(
	'../../dist/src/auth/login-otp.service.js'
);
const { SessionEventsService } = load(
	'../../dist/src/auth/session-events.service.js'
);
const express = load('express');
function target(name) {
	const value = process.env[name];
	assert.ok(value, `Missing ${name}`);
	const result = new URL(value);
	assert.ok(['postgres:', 'postgresql:'].includes(result.protocol));
	assert.ok(['127.0.0.1', 'localhost'].includes(result.hostname));
	assert.match(result.pathname, /^\/aerocrm_identity_test[a-z0-9_]*$/);
	assert.deepEqual(result.searchParams.getAll('schema'), ['identity']);
	assert.equal(result.hash, '');
	assert.match(
		decodeURIComponent(result.username),
		/^[a-z][a-z0-9_]{0,62}$/
	);
	return result;
}
const runtimeTarget = target('IDENTITY_TEST_DATABASE_URL'),
	migrationTarget = target('IDENTITY_TEST_MIGRATION_DATABASE_URL');
assert.equal(runtimeTarget.pathname, migrationTarget.pathname);
assert.equal(runtimeTarget.host, migrationTarget.host);
assert.notEqual(runtimeTarget.username, migrationTarget.username);
process.env.IDENTITY_DATABASE_URL = process.env.IDENTITY_TEST_DATABASE_URL;
assert.equal(process.env.IDENTITY_INTEGRATION_ALLOW_MUTATION, 'true');

const runtime = new PrismaClient({
	datasources: { db: { url: process.env.IDENTITY_TEST_DATABASE_URL } }
});
const admin = new PrismaClient({
	datasources: {
		db: { url: process.env.IDENTITY_TEST_MIGRATION_DATABASE_URL }
	}
});
const id = 'single-session-test-' + randomUUID();
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048
});
const jwk = {
	...publicKey.export({ format: 'jwk' }),
	kid: 'integration',
	alg: 'RS256',
	use: 'sig'
};
const config = new ConfigService({
	JWT_ACCESS_PRIVATE_KEY_BASE64: Buffer.from(
		privateKey.export({ format: 'pem', type: 'pkcs8' })
	).toString('base64'),
	JWT_ACCESS_JWKS_BASE64: Buffer.from(
		JSON.stringify({ keys: [jwk] })
	).toString('base64'),
	JWT_ACCESS_ACTIVE_KID: 'integration',
	JWT_ISSUER: 'test',
	JWT_AUDIENCE: 'test'
});
const jwt = new AccessJwtService(new JwtService(), config);
const include = {
	authIdentities: true,
	telegramNotificationChannel: true
};
const users = {
	findById: (userId) =>
		runtime.user.findUnique({ where: { id: userId }, include }),
	findByIdentity: (type, value) =>
		runtime.user.findFirst({
			where: { authIdentities: { some: { type, value } } },
			include
		})
};
const auth = new AuthService(
	runtime,
	users,
	jwt,
	new RefreshTokenService(),
	{ emitUserChanged: async () => {} },
	{},
	{},
	{}
);
const guard = new IdentityAuthGuard(
	{ getAllAndOverride: () => ['USER'] },
	jwt,
	runtime
);
const internal = new IdentityInternalService(runtime, jwt, {});
const events = new SessionEventsService(runtime);
let server;
const challengeIds = [];
const email = id + '@example.test';
const verifiedAt = new Date('2026-09-01T00:00:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const otp = new LoginOtpService(
	runtime,
	new ConfigService({ IDENTITY_LOGIN_OTP_ENABLED: 'true' }),
	{ isEmailConfigured: () => true, isSmsConfigured: () => false },
	jwt,
	new RefreshTokenService(),
	{}
);
const request = { ip: '192.0.2.41', headers: {}, get: () => undefined };
async function seedOtp() {
	const challengeId = randomUUID();
	challengeIds.push(challengeId);
	const browserToken = randomBytes(32).toString('base64url'),
		code = '654321';
	const identity = await admin.authIdentity.findUniqueOrThrow({
		where: { type_value: { type: 'EMAIL', value: email } }
	});
	await admin.loginOtpChallenge.create({
		data: {
			id: challengeId,
			channel: 'EMAIL',
			userId: id,
			authIdentityId: identity.id,
			identityVerifiedAt: verifiedAt,
			destinationHash: sha256('EMAIL:' + email),
			browserTokenHash: sha256(browserToken),
			codeHash: await hash(browserToken + ':' + code, 4),
			expiresAt: new Date(Date.now() + 300000)
		}
	});
	return { challengeId, browserToken, code };
}
async function timeout(promise, ms = 3000) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('Session stream timeout')),
					ms
				);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}
async function openStream(token, path = '/events') {
	const response = await fetch(
		'http://127.0.0.1:' + server.address().port + path,
		{ headers: { Authorization: 'Bearer ' + token } }
	);
	assert.equal(response.status, 200);
	const reader = response.body.getReader();
	const ready = await timeout(reader.read());
	assert.match(Buffer.from(ready.value).toString(), /event: ready/);
	return reader;
}

const guardToken = (token) =>
	guard.canActivate({
		getHandler: () => {},
		getClass: () => {},
		switchToHttp: () => ({
			getRequest: () => ({ headers: { authorization: 'Bearer ' + token } })
		})
	});
(async () => {
	try {
		await runtime.$connect();
		await admin.$connect();
		const [role] = await runtime.$queryRawUnsafe(
			"SELECT current_setting('server_version_num')::integer AS version, NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AS restricted FROM pg_roles WHERE rolname=current_user"
		);
		assert.equal(Math.floor(role.version / 10000), 18);
		assert.equal(role.restricted, true);
		await assert.rejects(
			runtime.$executeRawUnsafe(
				'CREATE TABLE identity.single_session_forbidden_probe (id INTEGER)'
			)
		);
		await admin.user.create({
			data: {
				id,
				password: await hash('correct-password', 4),
				authIdentities: {
					create: {
						type: 'EMAIL',
						value: id + '@example.test',
						verifiedAt
					}
				}
			}
		});
		const login = () =>
			auth.login({
				email: id + '@example.test',
				password: 'correct-password'
			});
		const first = await login();
		const sid = jwt.verify(first.accessToken).sid;
		assert.equal(await guardToken(first.accessToken), true);
		const app = express();
		app.get(['/events', '/short-events'], async (req, res) => {
			try {
				await guard.canActivate({
					getHandler: () => {},
					getClass: () => {},
					switchToHttp: () => ({ getRequest: () => req })
				});
				const payload = jwt.verify(req.headers.authorization.slice(7));
				await events.open(
					payload.sid,
					payload.sub,
					req.path === '/short-events'
						? Date.now() + 150
						: payload.exp * 1000,
					res
				);
			} catch (error) {
				res.status(error.getStatus?.() ?? 503).end();
			}
		});
		server = app.listen(0, '127.0.0.1');
		await new Promise((resolve) => server.once('listening', resolve));
		const reader = await openStream(first.accessToken);
		const second = await login();
		assert.equal(await guardToken(second.accessToken), true);
		await assert.rejects(guardToken(first.accessToken));
		await assert.rejects(
			internal.introspect('Bearer ' + first.accessToken)
		);
		await assert.rejects(auth.refresh(first.refreshToken));
		const revoked = await timeout(reader.read());
		assert.match(Buffer.from(revoked.value).toString(), /event: revoked/);
		await reader.cancel();
		assert.equal(
			await admin.userSession.count({
				where: { userId: id, revokedAt: null }
			}),
			1
		);
		console.log(
			'PASS second device revokes first access/refresh and live SSE'
		);
		await assert.rejects(
			auth.login({ email: id + '@example.test', password: 'wrong' })
		);
		assert.equal(await guardToken(second.accessToken), true);
		const issue = jwt.issue.bind(jwt);
		jwt.issue = () => {
			throw new Error('signing failed');
		};
		await assert.rejects(login());
		jwt.issue = issue;
		assert.equal(await guardToken(second.accessToken), true);
		console.log(
			'PASS failed credentials/signing preserve current session'
		);
		const candidate = await users.findById(id);
		const otpDto = await seedOtp();
		const parallel = await Promise.all([
			login(),
			login(),
			auth.startSession(candidate),
			auth.startSession(candidate),
			otp.verify(otpDto, request)
		]);
		assert.equal(
			await admin.userSession.count({
				where: { userId: id, revokedAt: null }
			}),
			1
		);
		const active = (
			await admin.userSession.findFirst({
				where: { userId: id, revokedAt: null }
			})
		).id;
		assert.equal(
			parallel.filter(
				(item) => jwt.verify(item.accessToken).sid === active
			).length,
			1
		);
		await assert.rejects(
			runtime.userSession.update({
				where: { id: sid },
				data: { revokedAt: null }
			})
		);
		await assert.rejects(
			runtime.userSession.update({
				where: { id: active },
				data: { userId: 'different' }
			})
		);
		console.log(
			'PASS concurrent password / OAuth-shared creator / OTP leave exactly one session and immutable history'
		);
		const current = parallel.find(
			(item) => jwt.verify(item.accessToken).sid === active
		);
		const refreshed = await auth.refresh(current.refreshToken);
		assert.equal(jwt.verify(refreshed.accessToken).sid, active);
		assert.equal(
			await admin.userSession.count({
				where: { userId: id, revokedAt: null }
			}),
			1
		);
		const race = await Promise.allSettled([
			auth.refresh(refreshed.refreshToken),
			login()
		]);
		assert.equal(race[1].status, 'fulfilled');
		const winner = race[1].value;
		assert.equal(await guardToken(winner.accessToken), true);
		if (race[0].status === 'fulfilled')
			await assert.rejects(guardToken(race[0].value.accessToken));
		assert.equal(
			await admin.userSession.count({
				where: { userId: id, revokedAt: null }
			}),
			1
		);
		console.log('PASS login / refresh race cannot resurrect old session');
		const expiring = await openStream(winner.accessToken, '/short-events');
		assert.equal((await timeout(expiring.read())).done, true);
		await expiring.cancel();
		const beforeLoss = await openStream(winner.accessToken);
		await events.client.end();
		assert.equal((await timeout(beforeLoss.read())).done, true);
		await beforeLoss.cancel();
		const reconnected = await openStream(winner.accessToken);
		await reconnected.cancel();
		const rejected = await fetch(
			'http://127.0.0.1:' + server.address().port + '/events',
			{ headers: { Authorization: 'Bearer ' + first.accessToken } }
		);
		assert.equal(rejected.status, 401);
		await rejected.body?.cancel();
		console.log(
			'PASS access lifetime and LISTEN loss close without revoked; reconnect freshly authorizes'
		);
		const failedOtp = await seedOtp();
		jwt.issue = () => {
			throw new Error('OTP signing failed');
		};
		await assert.rejects(otp.verify(failedOtp, request));
		jwt.issue = issue;
		assert.equal(
			(
				await admin.loginOtpChallenge.findUniqueOrThrow({
					where: { id: failedOtp.challengeId }
				})
			).consumedAt,
			null
		);
		assert.equal(await guardToken(winner.accessToken), true);
		await otp.verify(failedOtp, request);
		console.log(
			'PASS OTP signing failure rolls back challenge and revocation'
		);
		await auth.revokeAll(id);
		await assert.rejects(guardToken(refreshed.accessToken));
		console.log(
			'PASS refresh preserves sid; revokeAll invalidates access'
		);
		console.log('Identity single session PostgreSQL18 acceptance PASSED');
	} finally {
		await events.onApplicationShutdown();
		await new Promise((resolve) =>
			server ? server.close(resolve) : resolve()
		);
		await admin.loginOtpChallenge.deleteMany({
			where: { id: { in: challengeIds } }
		});
		await admin.user.deleteMany({ where: { id } });
		await runtime.$disconnect();
		await admin.$disconnect();
	}
})().catch((error) => {
	console.error(error.name + ': ' + error.message);
	process.exitCode = 1;
});
