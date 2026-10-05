import { ReportingJsonLogger } from './common/reporting-json.logger';
import {
	isReportingCorsOriginAllowed,
	parseReportingCorsAllowedOrigins
} from './config/reporting-cors.config';
import {
	parseReportingListenHost,
	parseReportingPort
} from './config/reporting-network.config';
import { ReportingModule } from './reporting.module';
import { terminateFailedBootstrap } from './runtime/bootstrap-failure';
import { parseReportingProcessRole } from './runtime/reporting-runtime.service';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import { NestFactory } from '@nestjs/core';

let application: INestApplication | undefined;

async function bootstrap(): Promise<void> {
	const role = parseReportingProcessRole(
		process.env.REPORTING_PROCESS_ROLE
	);
	const host = parseReportingListenHost(
		process.env.REPORTING_LISTEN_HOST,
		process.env.NODE_ENV
	);
	const port = parseReportingPort(process.env.REPORTING_PORT);
	const app = await NestFactory.create(ReportingModule, {
		logger: new ReportingJsonLogger(),
		forceCloseConnections: true
	});
	application = app;
	if (role === 'all' || role === 'api') {
		const allowedOrigins = parseReportingCorsAllowedOrigins(
			process.env.CORS_ALLOWED_ORIGINS
		);
		const corsOrigin: CustomOrigin = (origin, callback) =>
			callback(null, isReportingCorsOriginAllowed(origin, allowedOrigins));
		app.enableCors({
			origin: corsOrigin,
			credentials: true,
			exposedHeaders: 'set-cookie, x-request-id, x-correlation-id'
		});
	}
	app.useGlobalPipes(
		new ValidationPipe({
			transform: true,
			whitelist: true,
			forbidNonWhitelisted: true,
			stopAtFirstError: false
		})
	);
	app.enableShutdownHooks();
	await app.listen(port, host);
	Logger.log(
		`Reporting service started host=${host} port=${port} role=${role}`,
		'Bootstrap'
	);
}

void bootstrap().catch(() => {
	new ReportingJsonLogger().fatal('Reporting bootstrap failed', 'Bootstrap');
	return terminateFailedBootstrap(application);
});
