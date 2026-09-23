import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/crm-access-client';

const closed = (value: unknown) =>
	(value instanceof Prisma.PrismaClientKnownRequestError ||
		value instanceof Prisma.PrismaClientUnknownRequestError) &&
	(value.message.includes('crm_workspace_closed') ||
		JSON.stringify('meta' in value ? value.meta : null).includes('crm_workspace_closed'));

@Catch()
export class CrmAccessHttpExceptionFilter implements ExceptionFilter {
	catch(exception: unknown, host: ArgumentsHost): void {
		const response = host.switchToHttp().getResponse<Response>();
		if (!(exception instanceof HttpException)) {
			response.status(closed(exception) ? 403 : 500).json(closed(exception)
				? { statusCode: 403, message: 'Workspace is closed', error: 'ForbiddenException', code: 'crm_workspace_closed' }
				: { statusCode: 500, message: 'Internal server error', error: 'InternalServerError', code: 'internal_error' });
			return;
		}
		const status = exception.getStatus();
		const raw = exception.getResponse();
		const payload =
			typeof raw === 'object' && raw !== null
				? (raw as {
						message?: string | string[];
						error?: string;
						code?: string;
					})
				: null;
		response.status(status).json({
			statusCode: status,
			message:
				payload?.message ||
				(typeof raw === 'string' ? raw : 'Request failed'),
			error: payload?.error || exception.name,
			code:
				payload?.code ||
				(Array.isArray(payload?.message)
					? 'validation_error'
					: 'http_error')
		});
	}
}
