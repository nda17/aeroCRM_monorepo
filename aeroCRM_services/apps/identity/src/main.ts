import { Logger, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { IdentityHttpExceptionFilter } from './common/http-exception.filter';
import { identityRequestContext } from './common/request-context';
import { IdentityModule } from './identity.module';
import { terminateFailedBootstrap } from './runtime/bootstrap-failure';
import {
	IDENTITY_GLOBAL_PREFIX_EXCLUDES,
	identityCorsOrigins,
	identityListenHost,
	identityTrustProxy
} from './runtime/identity-http.config';
import {
	parseIdentityPort,
	parseIdentityProcessRole
} from './runtime/identity-runtime.service';

let application: INestApplication | undefined;

async function bootstrap(): Promise<void> {
	const role = parseIdentityProcessRole(process.env.IDENTITY_PROCESS_ROLE);
	const port = parseIdentityPort(role);
	const app = await NestFactory.create(IdentityModule, {
		forceCloseConnections: true
	});
	application = app;
	const instance = app.getHttpAdapter().getInstance();
	if (typeof instance?.set === 'function') {
		instance.set(
			'trust proxy',
			identityTrustProxy(process.env.TRUST_PROXY)
		);
	}
	app.setGlobalPrefix('api/v1', {
		exclude: [...IDENTITY_GLOBAL_PREFIX_EXCLUDES]
	});
	app.use(identityRequestContext);
	app.use(cookieParser());
	if (role === 'api') {
		app.enableCors({
			origin: identityCorsOrigins(
				process.env.MODE,
				process.env.CORS_ALLOWED_ORIGINS
			),
			credentials: true,
			exposedHeaders: 'set-cookie, x-request-id, x-correlation-id'
		});
	}
	app.useGlobalPipes(
		new ValidationPipe({
			transform: true,
			whitelist: true
		})
	);
	app.useGlobalFilters(new IdentityHttpExceptionFilter());
	app.enableShutdownHooks();
	const host = identityListenHost(
		process.env.MODE,
		process.env.IDENTITY_LISTEN_HOST
	);
	await app.listen(port, host);
	Logger.log(
		`Identity service started host=${host} port=${port} role=${role}`,
		'Bootstrap'
	);
}

void bootstrap().catch(() => {
	Logger.error('Identity bootstrap failed', undefined, 'Bootstrap');
	return terminateFailedBootstrap(application);
});
