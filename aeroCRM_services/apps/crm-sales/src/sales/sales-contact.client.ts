import {
	ForbiddenException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
	UnauthorizedException
} from '@nestjs/common';
import { serviceOrigin } from './sales-access';

@Injectable()
export class SalesContactClient {
	async resolveImportContacts(
		authorization: string,
		workspaceId: string,
		sourceKey: string,
		references: Array<{ kind: 'contact'; externalId?: string; id?: string }>
	): Promise<Array<{ id: string; name: string; version: number } | null>> {
		if (!references.length) return [];
		const origin = serviceOrigin(process.env.CRM_CUSTOMERS_INTERNAL_BASE_URL);
		let response: Response;
		try {
			response = await fetch(`${origin}/api/v1/crm/customers/imports/resolve`, {
				method: 'POST',
				headers: {
					Authorization: authorization,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ schemaVersion: 1, workspaceId, sourceKey, references }),
				cache: 'no-store',
				redirect: 'error',
				signal: AbortSignal.timeout(10000)
			});
		} catch {
			throw new ServiceUnavailableException('CRM contacts are temporarily unavailable');
		}
		if (response.status === 401) throw new UnauthorizedException();
		if (response.status === 403) throw new ForbiddenException();
		try {
			if (!response.ok) throw new Error();
			const value: unknown = await response.json();
			if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
			const root = value as Record<string, unknown>;
			if (
				Object.keys(root).sort().join(',') !== 'items,schemaVersion' ||
				root.schemaVersion !== 1 ||
				!Array.isArray(root.items) ||
				root.items.length !== references.length
			)
				throw new Error();
			return root.items.map((value, index) => {
				if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
				const item = value as Record<string, unknown>;
				if (
					Object.keys(item).sort().join(',') !== 'contact,error,index' ||
					item.index !== index ||
					(item.error !== null &&
						(typeof item.error !== 'string' || item.error.length > 200))
				)
					throw new Error();
				if (item.contact === null) {
					if (typeof item.error !== 'string' || !item.error) throw new Error();
					return null;
				}
				if (item.error !== null || !item.contact || typeof item.contact !== 'object' || Array.isArray(item.contact))
					throw new Error();
				const contact = item.contact as Record<string, unknown>;
				if (
					Object.keys(contact).sort().join(',') !== 'id,name,version' ||
					typeof contact.id !== 'string' ||
					!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contact.id) ||
					typeof contact.name !== 'string' ||
					!contact.name.trim() ||
					contact.name.length > 200 ||
					!Number.isSafeInteger(contact.version) ||
					Number(contact.version) < 1
				)
					throw new Error();
				return { id: contact.id, name: contact.name, version: Number(contact.version) };
			});
		} catch {
			throw new ServiceUnavailableException('CRM contact response is unavailable');
		}
	}
	async requireContact(
		authorization: string,
		workspaceId: string,
		contactId: string
	): Promise<{ id: string; name: string }> {
		const origin = serviceOrigin(
			process.env.CRM_CUSTOMERS_INTERNAL_BASE_URL
		);
		let response: Response;
		try {
			response = await fetch(
				`${origin}/api/v1/crm/customers/contacts/${encodeURIComponent(contactId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
				{
					headers: { Authorization: authorization },
					cache: 'no-store',
					redirect: 'error',
					signal: AbortSignal.timeout(5000)
				}
			);
		} catch {
			throw new ServiceUnavailableException(
				'CRM contacts are temporarily unavailable'
			);
		}
		if (response.status === 401) throw new UnauthorizedException();
		if (response.status === 403) throw new ForbiddenException();
		if (response.status === 404)
			throw new NotFoundException({
				code: 'crm_sales_contact_not_found',
				message: 'Контакт недоступен'
			});
		try {
			if (!response.ok) throw new Error();
			const data: unknown = await response.json();
			if (!data || typeof data !== 'object' || Array.isArray(data))
				throw new Error();
			const root = data as Record<string, unknown>;
			if (
				root.schemaVersion !== 1 ||
				Object.keys(root).sort().join(',') !== 'contact,schemaVersion' ||
				!root.contact ||
				typeof root.contact !== 'object' ||
				Array.isArray(root.contact)
			)
				throw new Error();
			const contact = root.contact as Record<string, unknown>;
			const keys = [
				'id',
				'workspaceId',
				'name',
				'notes',
				'createdBySubject',
				'teamId',
				'version',
				'archivedAt',
				'createdAt',
				'updatedAt',
				'phone',
				'email',
				'companyId'
			];
			if (
				Object.keys(contact).length !== keys.length ||
				keys.some(key => !(key in contact)) ||
				contact.id !== contactId ||
				contact.workspaceId !== workspaceId ||
				contact.archivedAt !== null ||
				typeof contact.name !== 'string' ||
				!contact.name.trim() ||
				contact.name.length > 200
			)
				throw new Error();
			return { id: contactId, name: contact.name };
		} catch {
			throw new ServiceUnavailableException(
				'CRM contact response is unavailable'
			);
		}
	}
}
