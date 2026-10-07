import {
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
	UnauthorizedException
} from '@nestjs/common';
import {
	salesAccessToken,
	serviceOrigin,
	UUID,
	type SalesAccess
} from '../sales/sales-access';
import { boundedSalesContextJson } from '../sales/sales-context.client';
import type { TaskAssigneeDto } from './workday.dto';

export interface SalesAssignee extends TaskAssigneeDto {
	role: Exclude<SalesAccess['role'], 'ANALYST'>;
	dataScope: SalesAccess['dataScope'];
	teamIds: string[];
}
function exact(
	value: unknown,
	keys: string[]
): value is Record<string, unknown> {
	return (
		!!value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every(key => key in value)
	);
}

@Injectable()
export class SalesAssigneeClient {
	async resolve(
		authorization: string,
		access: SalesAccess,
		subject: string,
		teamId?: string,
		signal?: AbortSignal
	): Promise<SalesAssignee> {
		return this.request(
			authorization,
			access,
			{ subject },
			teamId,
			true,
			signal
		);
	}

	async authorize(
		authorization: string,
		access: SalesAccess,
		assignee: TaskAssigneeDto,
		teamId?: string,
		signal?: AbortSignal
	): Promise<SalesAssignee> {
		return this.request(
			authorization,
			access,
			assignee,
			teamId,
			false,
			signal
		);
	}

	async readers(
		authorization: string,
		access: SalesAccess,
		bindings: Array<{ subject: string; membershipId: string | null }>,
		signal?: AbortSignal
	): Promise<Array<SalesAssignee | null>> {
		if (
			bindings.length > 100 ||
			new Set(bindings.map(item => JSON.stringify(item))).size !==
				bindings.length
		)
			throw new ConflictException('crm_sales_assignment_reader_limit');
		if (!bindings.length) return [];
		try {
			const response = await fetch(
				`${serviceOrigin(process.env.CRM_ACCESS_INTERNAL_BASE_URL)}/internal/v1/crm-access/resolve-sales-task-readers`,
				{
					method: 'POST',
					headers: {
						Authorization: authorization,
						'content-type': 'application/json',
						'x-aerocrm-service': 'crm-sales',
						'x-aerocrm-internal-token': salesAccessToken()
					},
					body: JSON.stringify({
						schemaVersion: 1,
						workspaceId: access.workspaceId,
						bindings
					}),
					redirect: 'error',
					cache: 'no-store',
					signal: signal ?? AbortSignal.timeout(5000)
				}
			);
			if (!response.ok) {
				await response.body?.cancel();
				if (response.status === 401) throw new UnauthorizedException();
				if (response.status === 403) throw new ForbiddenException();
				if (response.status === 409)
					throw new ConflictException(
						'crm_sales_assignment_task_access_conflict'
					);
				throw new Error();
			}
			const value = await boundedSalesContextJson(response);
			if (
				!exact(value, [
					'schemaVersion',
					'workspaceId',
					'subject',
					'items'
				]) ||
				value.schemaVersion !== 1 ||
				value.workspaceId !== access.workspaceId ||
				value.subject !== access.subject ||
				!Array.isArray(value.items) ||
				value.items.length !== bindings.length
			)
				throw new Error();
			return value.items.map((item, index) => {
				if (
					!exact(item, ['binding', 'reader']) ||
					!exact(item.binding, ['subject', 'membershipId']) ||
					item.binding.subject !== bindings[index].subject ||
					item.binding.membershipId !== bindings[index].membershipId
				)
					throw new Error();
				const reader = item.reader;
				if (reader === null) return null;
				if (
					bindings[index].membershipId === null ||
					!exact(reader, [
						'subject',
						'membershipId',
						'role',
						'dataScope',
						'teamIds'
					]) ||
					reader.subject !== bindings[index].subject ||
					reader.membershipId !== bindings[index].membershipId ||
					![
						'OWNER',
						'CRM_ADMIN',
						'TEAM_LEAD',
						'MANAGER',
						'CUSTOM'
					].includes(String(reader.role)) ||
					!['ALL', 'TEAM', 'OWN'].includes(String(reader.dataScope)) ||
					!Array.isArray(reader.teamIds) ||
					reader.teamIds.length > 10000 ||
					reader.teamIds.some(
						id => typeof id !== 'string' || !UUID.test(id)
					) ||
					new Set(reader.teamIds).size !== reader.teamIds.length
				)
					throw new Error();
				return reader as unknown as SalesAssignee;
			});
		} catch (error) {
			if (
				error instanceof UnauthorizedException ||
				error instanceof ForbiddenException ||
				error instanceof ConflictException
			)
				throw error;
			throw new ServiceUnavailableException(
				'Не удалось проверить доступ к параллельным задачам'
			);
		}
	}

	private async request(
		authorization: string,
		access: SalesAccess,
		assignee: { subject: string; membershipId?: string },
		teamId?: string,
		resolve = false,
		signal?: AbortSignal
	): Promise<SalesAssignee> {
		if (!/^Bearer [^\s]{1,16384}$/.test(authorization))
			throw new UnauthorizedException();
		const origin = serviceOrigin(process.env.CRM_ACCESS_INTERNAL_BASE_URL);
		const token = salesAccessToken();
		try {
			const response = await fetch(
				`${origin}/internal/v1/crm-access/${resolve ? 'resolve-sales-assignee' : 'authorize-assignee'}`,
				{
					method: 'POST',
					headers: {
						Authorization: authorization,
						'content-type': 'application/json',
						'x-aerocrm-service': 'crm-sales',
						'x-aerocrm-internal-token': token
					},
					body: JSON.stringify({
						schemaVersion: 1,
						...(resolve ? {} : { purpose: 'SALES_ASSIGNMENT' }),
						workspaceId: access.workspaceId,
						subject: assignee.subject,
						membershipId: assignee.membershipId,
						...(teamId ? { teamId } : {})
					}),
					redirect: 'error',
					cache: 'no-store',
					signal: signal ?? AbortSignal.timeout(5000)
				}
			);
			if (!response.ok) {
				await response.body?.cancel();
				if (response.status === 401) throw new UnauthorizedException();
				if (response.status === 403) throw new ForbiddenException();
				if (response.status === 404)
					throw new NotFoundException('Ответственный недоступен');
				throw new Error();
			}
			if (
				!response.headers
					.get('content-type')
					?.toLowerCase()
					.startsWith('application/json') ||
				!response.body
			)
				throw new Error();
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			try {
				for (;;) {
					const part = await reader.read();
					if (part.done) break;
					bytes += part.value.byteLength;
					if (bytes > 512 * 1024) throw new Error();
					chunks.push(part.value);
				}
			} finally {
				await reader.cancel().catch(() => undefined);
				reader.releaseLock();
			}
			const value: unknown = JSON.parse(
				Buffer.concat(chunks).toString('utf8')
			);
			if (
				!exact(value, [
					'schemaVersion',
					'workspaceId',
					'subject',
					'assignee'
				]) ||
				value.schemaVersion !== 1 ||
				value.workspaceId !== access.workspaceId ||
				value.subject !== access.subject
			)
				throw new Error();
			const target = value.assignee;
			if (
				!exact(target, [
					'subject',
					'membershipId',
					'role',
					'dataScope',
					'teamIds'
				]) ||
				target.subject !== assignee.subject ||
				typeof target.membershipId !== 'string' ||
				!UUID.test(target.membershipId) ||
				(!resolve && target.membershipId !== assignee.membershipId) ||
				!['OWNER', 'CRM_ADMIN', 'TEAM_LEAD', 'MANAGER', 'CUSTOM'].includes(
					String(target.role)
				) ||
				!['ALL', 'TEAM', 'OWN'].includes(String(target.dataScope)) ||
				!Array.isArray(target.teamIds) ||
				target.teamIds.length > 10000 ||
				target.teamIds.some(
					id => typeof id !== 'string' || !UUID.test(id)
				) ||
				new Set(target.teamIds).size !== target.teamIds.length
			)
				throw new Error();
			return target as unknown as SalesAssignee;
		} catch (error) {
			if (
				error instanceof UnauthorizedException ||
				error instanceof ForbiddenException ||
				error instanceof NotFoundException
			)
				throw error;
			throw new ServiceUnavailableException(
				'Не удалось проверить ответственного'
			);
		}
	}
}
