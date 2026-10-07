import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
		const request = host.switchToHttp().getRequest<Request & { crmInternalCaller?: string }>();
		if (status === 403 && request?.method === 'POST' && request.path === '/internal/v1/crm-access/authorize-mail-workflow' &&
			request.crmInternalCaller === 'crm-customers' && request.body?.purpose === 'MAIL_SYNC' &&
			raw && typeof raw === 'object' && !Array.isArray(raw)) {
			const denied = raw as Record<string, unknown>;
			const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
			if (Object.keys(denied).sort().join(',') === 'code,membershipId,reason,schemaVersion,subject,workspaceId' &&
				denied.schemaVersion === 1 && denied.code === 'crm_mail_authority_revoked' &&
				typeof denied.workspaceId === 'string' && uuid.test(denied.workspaceId) && denied.workspaceId === request.body.workspaceId &&
				typeof denied.subject === 'string' && /^[^\s\x00-\x1f\x7f]{1,256}$/.test(denied.subject) && denied.subject === request.body.subject &&
				typeof denied.membershipId === 'string' && uuid.test(denied.membershipId) && denied.membershipId === request.body.membershipId &&
				typeof denied.reason === 'string' && ['MEMBERSHIP_REVOKED', 'ROLE_REVOKED', 'MAIL_READ_REVOKED'].includes(denied.reason)) {
				response.status(status).json(denied);
				return;
			}
		}

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
