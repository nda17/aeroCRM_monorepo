import {
	BadRequestException,
	Injectable,
	ServiceUnavailableException,
	UnauthorizedException
} from '@nestjs/common';
import { intakeOperationToken } from '../intake-operations/intake-operation.client';
import {
	salesAccessToken,
	serviceOrigin,
	UUID,
	type SalesAccess
} from './sales-access';

export interface CompanyPreview {
	contactId: string;
	company: null | { id: string; name: string; inn: string | null };
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
export async function boundedSalesContextJson(
	response: Response
): Promise<unknown> {
	if (
		!response.body ||
		!/^application\/json\b/i.test(
			response.headers.get('content-type') ?? ''
		)
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
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

@Injectable()
export class SalesContextClient {
	async search(
		authorization: string,
		access: SalesAccess,
		search: string
	): Promise<string[]> {
		const value = await this.post(authorization, access, 'search', {
			search
		});
		if (value === null) return [];
		if (
			!exact(value, [
				'schemaVersion',
				'workspaceId',
				'subject',
				'contactIds'
			]) ||
			value.schemaVersion !== 1 ||
			value.workspaceId !== access.workspaceId ||
			value.subject !== access.subject ||
			!Array.isArray(value.contactIds) ||
			value.contactIds.length > 10000 ||
			value.contactIds.some(
				id => typeof id !== 'string' || !UUID.test(id)
			) ||
			new Set(value.contactIds).size !== value.contactIds.length
		)
			this.invalid();
		return value.contactIds as string[];
	}
	async preview(
		authorization: string,
		access: SalesAccess,
		contactIds: string[]
	): Promise<CompanyPreview[]> {
		const ids = [...new Set(contactIds)];
		if (ids.length > 100) throw new BadRequestException();
		if (!ids.length) return [];
		const value = await this.post(authorization, access, 'preview', {
			contactIds: ids
		});
		if (value === null)
			return ids.map(contactId => ({ contactId, company: null }));
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
			value.items.length !== ids.length
		)
			this.invalid();
		const items = value.items as unknown[];
		const parsed = items.map(item => {
			if (
				!exact(item, ['contactId', 'company']) ||
				typeof item.contactId !== 'string' ||
				!ids.includes(item.contactId)
			)
				this.invalid();
			const company = item.company;
			if (
				company !== null &&
				(!exact(company, ['id', 'name', 'inn']) ||
					typeof company.id !== 'string' ||
					!UUID.test(company.id) ||
					typeof company.name !== 'string' ||
					!company.name.trim() ||
					company.name.length > 200 ||
					(company.inn !== null &&
						(typeof company.inn !== 'string' ||
							!/^\d{10}(\d{2})?$/.test(company.inn))))
			)
				this.invalid();
			return item as unknown as CompanyPreview;
		});
		if (new Set(parsed.map(item => item.contactId)).size !== ids.length)
			this.invalid();
		return parsed;
	}
	async roster(authorization: string, access: SalesAccess, page: number) {
		const value = await this.post(
			authorization,
			access,
			'roster',
			{},
			page
		);
		if (
			!exact(value, [
				'schemaVersion',
				'workspaceId',
				'subject',
				'page',
				'pageSize',
				'total',
				'items',
				'selected'
			]) ||
			value.schemaVersion !== 1 ||
			value.workspaceId !== access.workspaceId ||
			value.subject !== access.subject ||
			value.page !== page ||
			value.pageSize !== 20 ||
			!Number.isSafeInteger(value.total) ||
			Number(value.total) < 0 ||
			!Array.isArray(value.items) ||
			value.items.length > 20 ||
			value.selected !== null
		)
			this.invalid();
		const items = value.items as unknown[];
		const subjects = items.map(item => {
			if (
				!exact(item, [
					'subject',
					'membershipId',
					'displayName',
					'verifiedEmail',
					'role'
				]) ||
				typeof item.subject !== 'string' ||
				!/^[^\s\x00-\x1f\x7f]{1,256}$/.test(item.subject) ||
				typeof item.membershipId !== 'string' ||
				!UUID.test(item.membershipId) ||
				!['OWNER', 'CRM_ADMIN', 'TEAM_LEAD', 'MANAGER', 'CUSTOM'].includes(
					String(item.role)
				) ||
				(item.displayName !== null &&
					(typeof item.displayName !== 'string' ||
						item.displayName.length > 300)) ||
				(item.verifiedEmail !== null &&
					(typeof item.verifiedEmail !== 'string' ||
						item.verifiedEmail.length > 320))
			)
				this.invalid();
			return item.subject;
		});
		if (new Set(subjects).size !== subjects.length) this.invalid();
		return { subjects, hasMore: page * 20 < Number(value.total) };
	}
	private async post(
		authorization: string,
		access: SalesAccess,
		kind: 'search' | 'preview' | 'roster',
		body: object,
		page = 1
	): Promise<unknown | null> {
		try {
			const roster = kind === 'roster';
			const origin = serviceOrigin(
				roster
					? process.env.CRM_ACCESS_INTERNAL_BASE_URL
					: process.env.CRM_CUSTOMERS_INTERNAL_BASE_URL
			);
			const token = roster
				? salesAccessToken()
				: intakeOperationToken('CRM_CUSTOMERS_CRM_SALES_TOKEN');
			const path = roster
				? `/api/v1/crm/access/team/assignees?workspaceId=${encodeURIComponent(access.workspaceId)}&purpose=SALES_ANALYTICS&page=${page}&pageSize=20`
				: `/internal/v1/crm-customers/sales-context/${kind}`;
			const response = await fetch(origin + path, {
				method: roster ? 'GET' : 'POST',
				headers: {
					Authorization: authorization,
					'content-type': 'application/json',
					'x-aerocrm-service': 'crm-sales',
					'x-aerocrm-internal-token': token
				},
				...(roster
					? {}
					: {
							body: JSON.stringify({
								schemaVersion: 1,
								workspaceId: access.workspaceId,
								...body
							})
						}),
				redirect: 'error',
				cache: 'no-store',
				signal: AbortSignal.timeout(10000)
			});
			if (!response.ok) {
				await response.body?.cancel();
				if (response.status === 401) throw new UnauthorizedException();
				if (response.status === 403 && !roster) return null;
				if (response.status === 400 && kind === 'search')
					throw new BadRequestException('Уточните поиск компании');
				throw new Error();
			}
			return await boundedSalesContextJson(response);
		} catch (error) {
			if (
				error instanceof BadRequestException ||
				error instanceof UnauthorizedException
			)
				throw error;
			throw new ServiceUnavailableException(
				'Контекст продаж временно недоступен'
			);
		}
	}
	private invalid(): never {
		throw new ServiceUnavailableException('Некорректный контекст продаж');
	}
}
