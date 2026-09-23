import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/billing-client';

const closed = (value: unknown) =>
	(value instanceof Prisma.PrismaClientKnownRequestError ||
		value instanceof Prisma.PrismaClientUnknownRequestError) &&
	(value.message.includes('crm_workspace_closed') ||
		JSON.stringify('meta' in value ? value.meta : null).includes('crm_workspace_closed'));

const ERROR_MAP: Record<string, { code: string; message: string }> = {
	'У тебя нет прав!': {
		code: 'forbidden',
		message: 'У вас нет прав для выполнения этого действия.'
	}
};

@Catch()
export class BillingHttpExceptionFilter implements ExceptionFilter {
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
		if (typeof raw === 'string') {
			const mapped = ERROR_MAP[raw];
			response.status(status).json({
				statusCode: status,
				message: mapped?.message || raw,
				error: exception.name,
				code: mapped?.code || 'http_error'
			});
			return;
		}
		if (typeof raw === 'object' && raw !== null) {
			const payload = raw as {
				message?: string | string[];
				error?: string;
				code?: string;
			};
			if (Array.isArray(payload.message)) {
				response.status(status).json({
					statusCode: status,
					message: payload.message,
					error: payload.error || exception.name,
					code: payload.code || 'validation_error'
				});
				return;
			}
			const mapped = payload.message
				? ERROR_MAP[payload.message]
				: undefined;
			response.status(status).json({
				statusCode: status,
				message: mapped?.message || payload.message || 'Ошибка запроса.',
				error: payload.error || exception.name,
				code: payload.code || mapped?.code || 'http_error'
			});
			return;
		}
		response.status(status).json({
			statusCode: status,
			message: 'Ошибка запроса.',
			error: exception.name,
			code: 'http_error'
		});
	}
}
