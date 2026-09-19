import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	authenticatedRequest,
	AuthenticatedApiError
} from '@/shared/api/authenticated-http-client'
import { getCustomer, listCustomers, mutateCustomer } from './customer.api'
import { lookupCompany } from './company-lookup.api'
vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<
			typeof import('@/shared/api/authenticated-http-client')
		>()),
		authenticatedRequest: vi.fn()
	})
)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const base = {
	id,
	workspaceId,
	name: 'Компания',
	notes: null,
	createdBySubject: 'user-1',
	teamId: null,
	version: 1,
	archivedAt: null,
	createdAt: '2026-09-07T00:00:00.000Z',
	updatedAt: '2026-09-07T00:00:00.000Z'
}
const legacy = { ...base, inn: '1234567890', website: null }
const company = {
	...legacy,
	legalName: null,
	kpp: null,
	ogrn: null,
	legalAddress: null,
	entityType: null
}
const contact = { ...base, phone: null, email: null, companyId: null }
beforeEach(() => vi.resetAllMocks())
describe('versioned company API', () => {
	it('reads companies via v2 with server pagination/search and exact response', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 2,
			items: [company],
			page: 2,
			pageSize: 25,
			total: 26
		})
		await listCustomers(
			'token',
			'companies',
			workspaceId,
			2,
			25,
			'Компания'
		)
		expect(authenticatedRequest).toHaveBeenLastCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/customers/v2/companies',
			params: {
				workspaceId,
				page: '2',
				pageSize: '25',
				search: 'Компания'
			}
		})
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 2,
			company
		})
		await getCustomer('token', 'companies', workspaceId, id)
		expect(authenticatedRequest).toHaveBeenLastCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: `/crm/customers/v2/companies/${id}`,
			params: { workspaceId }
		})
	})
	it('never downgrades missing v2 or retries provider calls automatically', async () => {
		vi.mocked(authenticatedRequest).mockRejectedValue(
			new AuthenticatedApiError('notFound', 'Нет маршрута')
		)
		await expect(
			getCustomer('token', 'companies', workspaceId, id)
		).rejects.toMatchObject({ kind: 'notFound' })
		expect(authenticatedRequest).toHaveBeenCalledTimes(1)
	})
	it.each([
		{ id: undefined, archive: false, method: 'POST', suffix: '' },
		{ id, archive: false, method: 'PUT', suffix: `/${id}` },
		{ id, archive: true, method: 'POST', suffix: `/${id}/archive` }
	])(
		'uses explicit v2 for new company commands: $method $suffix',
		async scenario => {
			vi.mocked(authenticatedRequest).mockResolvedValue({
				schemaVersion: 2,
				company: {
					...company,
					archivedAt: scenario.archive ? base.updatedAt : null
				}
			})
			await mutateCustomer('token', {
				schemaVersion: 2,
				kind: 'companies',
				workspaceId,
				commandId,
				id: scenario.id,
				expectedVersion: 1,
				archive: scenario.archive,
				fields: {
					name: 'Компания',
					notes: null,
					teamId: null,
					inn: '1234567890',
					website: null,
					legalName: null,
					kpp: null,
					ogrn: null,
					legalAddress: null,
					entityType: null
				}
			})
			expect(authenticatedRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					method: scenario.method,
					url: `/crm/customers/v2/companies${scenario.suffix}`,
					headers: { 'Idempotency-Key': commandId },
					data: expect.objectContaining({
						schemaVersion: 2,
						workspaceId,
						commandId
					})
				})
			)
			const data = vi.mocked(authenticatedRequest).mock.calls[0][0]
				.data as Record<string, unknown>
			expect(data.expectedVersion).toBe(scenario.id ? 1 : undefined)
			expect('legalName' in data).toBe(!scenario.archive)
		}
	)
	it('replays legacy company commands as v1 without changing their receipt namespace or body', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			company: legacy
		})
		await mutateCustomer('token', {
			kind: 'companies',
			workspaceId,
			commandId,
			fields: {
				name: 'Компания',
				notes: null,
				teamId: null,
				inn: null,
				website: null
			}
		})
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/customers/companies',
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				name: 'Компания',
				inn: null,
				notes: null,
				teamId: null,
				website: null
			}
		})
	})
	it('reads contact v2 while replaying existing commands at v1 without new fields', async () => {
		const v2 = {
			...contact,
			timeZone: null,
			preferredCallStart: null,
			preferredCallEnd: null
		}
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 2,
			contact: v2
		})
		await getCustomer('token', 'contacts', workspaceId, id)
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			contact
		})
		await mutateCustomer('token', {
			kind: 'contacts',
			workspaceId,
			commandId,
			fields: {
				name: 'Клиент',
				notes: null,
				teamId: null,
				phone: null,
				email: null,
				companyId: null
			}
		})
		expect(
			vi.mocked(authenticatedRequest).mock.calls.map(([call]) => call.url)
		).toEqual([
			`/crm/customers/v2/contacts/${id}`,
			'/crm/customers/contacts'
		])
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 2,
			contact: v2
		})
		await mutateCustomer('token', {
			kind: 'contacts',
			schemaVersion: 2,
			workspaceId,
			commandId
		})
		expect(authenticatedRequest).toHaveBeenLastCalledWith(
			expect.objectContaining({
				url: '/crm/customers/v2/contacts',
				data: { schemaVersion: 2, workspaceId, commandId }
			})
		)
		expect(authenticatedRequest).toHaveBeenCalledTimes(3)
	})
})
describe('company lookup API privacy', () => {
	it('puts the INN in a POST body, never query parameters, and exposes only parsed data', async () => {
		const result = {
			schemaVersion: 1,
			provider: 'DADATA',
			queriedAt: base.updatedAt,
			inn: '7707083893',
			items: []
		}
		vi.mocked(authenticatedRequest).mockResolvedValue(result)
		expect(await lookupCompany('token', workspaceId, result.inn)).toEqual(
			result
		)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/customers/company-lookup',
			data: { schemaVersion: 1, workspaceId, inn: result.inn },
			mapError: expect.any(Function)
		})
		const mapError = vi.mocked(authenticatedRequest).mock.calls[0][0]
			.mapError!
		expect(
			mapError({
				isAxiosError: true,
				response: { status: 429, data: { token: 'private' } }
			})
		).toMatchObject({
			kind: 'temporary',
			message: expect.not.stringContaining('private')
		})
	})
	it('does not send invalid checksums or unbound workspace identifiers', async () => {
		await expect(
			lookupCompany('token', workspaceId, '7707083894')
		).rejects.toMatchObject({ kind: 'validation' })
		await expect(
			lookupCompany('token', 'wrong', '7707083893')
		).rejects.toMatchObject({ kind: 'validation' })
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('rejects cross-INN or extra private fields rather than rendering a partial response', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			provider: 'DADATA',
			queriedAt: base.updatedAt,
			inn: '500100732259',
			items: []
		})
		await expect(
			lookupCompany('token', workspaceId, '7707083893')
		).rejects.toMatchObject({ kind: 'temporary' })
	})
})
