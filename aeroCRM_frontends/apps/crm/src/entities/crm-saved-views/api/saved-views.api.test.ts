import {
	AuthenticatedApiError,
	authenticatedRequest
} from '@/shared/api/authenticated-http-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listSavedViews, mutateSavedView } from './saved-views.api'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))

const request = vi.mocked(authenticatedRequest)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const commandId = '22222222-2222-4222-8222-222222222222'
const base = {
	workspaceId,
	subject: 'actor',
	scope: 'DEALS' as const
}
const parameters = {
	search: '',
	pipelineId: '',
	status: '',
	withoutNextAction: false,
	layout: 'list' as const,
	sort: 'created_desc' as const
}
const view = {
	id: '33333333-3333-4333-8333-333333333333',
	...base,
	name: 'Мои сделки',
	parameters,
	version: 1,
	legacyKey: null,
	archivedAt: null,
	createdAt: '2026-10-01T10:00:00.000Z',
	updatedAt: '2026-10-01T10:00:00.000Z'
}

describe('saved views API binding and command contract', () => {
	beforeEach(() => vi.clearAllMocks())

	it('lists by workspace and scope and rejects a response for a different actor', async () => {
		request.mockResolvedValue({
			schemaVersion: 1,
			...base,
			items: [view]
		})
		await expect(listSavedViews('token', base)).resolves.toMatchObject({
			items: [view]
		})
		expect(request).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/access/saved-views',
			params: { workspaceId, scope: 'DEALS' }
		})

		request.mockResolvedValue({
			schemaVersion: 1,
			...base,
			subject: 'another-actor',
			items: []
		})
		await expect(listSavedViews('token', base)).rejects.toMatchObject({
			kind: 'temporary'
		})
	})

	it('does not issue a request for an invalid workspace binding', async () => {
		await expect(
			listSavedViews('token', { ...base, workspaceId: 'bad-id' })
		).rejects.toBeInstanceOf(AuthenticatedApiError)
		expect(request).not.toHaveBeenCalled()
	})

	it('sends a personal create with a stable command idempotency key', async () => {
		request.mockResolvedValue({ schemaVersion: 1, view })
		await mutateSavedView('token', {
			...base,
			commandId,
			mutation: { kind: 'create', name: ' Мои сделки ', parameters }
		})
		expect(request).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/access/saved-views',
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				scope: 'DEALS',
				name: 'Мои сделки',
				parameters
			}
		})
	})
})
