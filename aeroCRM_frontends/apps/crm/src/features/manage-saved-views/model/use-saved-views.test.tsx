import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	crmPermissionScope,
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import {
	listSavedViews,
	mutateSavedView
} from '@/entities/crm-saved-views'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { useSavedViews, type SavedViewsContext } from './use-saved-views'

vi.mock('@/entities/crm-access', async original => ({
	...(await original<object>()),
	getCrmPermissions: vi.fn()
}))
vi.mock('@/entities/crm-saved-views', async original => ({
	...(await original<object>()),
	listSavedViews: vi.fn(),
	mutateSavedView: vi.fn()
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const authority: CrmPermissions = {
	schemaVersion: 1,
	workspaceId,
	subject: 'actor',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['sales:read', 'sales:write']
}
const parameters = {
	search: '',
	pipelineId: '',
	status: '',
	withoutNextAction: false,
	layout: 'list' as const,
	sort: 'created_desc' as const
}
const page = {
	schemaVersion: 1 as const,
	workspaceId,
	subject: 'actor',
	scope: 'DEALS' as const,
	items: []
}
const context = (): SavedViewsContext => ({
	workspace: { workspaceId, canWrite: true } as never,
	session: { userId: 'actor', accessToken: 'token' },
	sessionRevision: useSessionStore.getState().sessionRevision,
	permissions: { isFetching: false, data: authority } as never,
	canRead: true,
	scopeKey: crmPermissionScope(authority),
	key: [
		workspaceId,
		'actor',
		useSessionStore.getState().sessionRevision,
		'owner'
	]
})
let client: QueryClient
const wrapper = ({ children }: PropsWithChildren) => (
	<QueryClientProvider client={client}>
		<PendingCommandProvider owner={commandOwner('actor', 1)}>
			{children}
		</PendingCommandProvider>
	</QueryClientProvider>
)

beforeEach(() => {
	vi.clearAllMocks()
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	resetSessionStore()
	useSessionStore.getState().setAuthenticated({
		accessToken: 'token',
		userId: 'actor'
	})
	vi.mocked(listSavedViews).mockResolvedValue(page)
	vi.mocked(getCrmPermissions).mockResolvedValue(authority)
	vi.mocked(mutateSavedView).mockResolvedValue({
		schemaVersion: 1,
		view: {
			id: '33333333-3333-4333-8333-333333333333',
			workspaceId,
			subject: 'actor',
			scope: 'DEALS',
			name: 'Мои сделки',
			parameters,
			version: 1,
			legacyKey: null,
			archivedAt: null,
			createdAt: '2026-10-01T10:00:00.000Z',
			updatedAt: '2026-10-01T10:00:00.000Z'
		}
	} as never)
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
})

describe('saved views lifecycle', () => {
	it('loads through the actor/workspace binding without polling permissions', async () => {
		const saved = vi.fn()
		const { result, rerender } = renderHook(
			() => useSavedViews(context(), 'DEALS', saved),
			{ wrapper }
		)
		await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
		expect(listSavedViews).toHaveBeenCalledExactlyOnceWith('token', {
			workspaceId,
			subject: 'actor',
			scope: 'DEALS'
		})
		for (let index = 0; index < 3; index++) rerender()
		expect(getCrmPermissions).not.toHaveBeenCalled()
		expect(listSavedViews).toHaveBeenCalledTimes(1)
	})

	it('reauthorizes and retries an unknown command with the identical command id and payload', async () => {
		vi.mocked(mutateSavedView)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown')
			)
			.mockResolvedValueOnce({
				schemaVersion: 1,
				view: {
					id: '33333333-3333-4333-8333-333333333333',
					workspaceId,
					subject: 'actor',
					scope: 'DEALS',
					name: 'Мои сделки',
					parameters,
					version: 1,
					legacyKey: null,
					archivedAt: null,
					createdAt: '2026-10-01T10:00:00.000Z',
					updatedAt: '2026-10-01T10:00:00.000Z'
				}
			} as never)
		const saved = vi.fn()
		const { result } = renderHook(
			() => useSavedViews(context(), 'DEALS', saved),
			{ wrapper }
		)
		await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
		const create = {
			kind: 'create' as const,
			name: 'Мои сделки',
			parameters
		}
		await act(() => result.current.command.execute(create))
		expect(result.current.command.uncertain).toBe(true)
		const first = structuredClone(
			vi.mocked(mutateSavedView).mock.calls[0][1]
		)
		expect(first).toMatchObject({
			workspaceId,
			subject: 'actor',
			scope: 'DEALS',
			mutation: create
		})
		await act(() => result.current.command.execute())
		expect(
			vi.mocked(mutateSavedView).mock.calls.map(([, command]) => command)
		).toEqual([first, first])
		expect(getCrmPermissions).toHaveBeenCalledTimes(2)
		expect(saved).toHaveBeenCalledOnce()
	})

	it('does not dispatch personal CRUD when the actor is read only', async () => {
		const readOnlyContext = {
			...context(),
			workspace: { workspaceId, canWrite: false } as never
		}
		const { result } = renderHook(
			() => useSavedViews(readOnlyContext, 'DEALS', vi.fn()),
			{ wrapper }
		)
		await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
		await act(() =>
			result.current.command.execute({
				kind: 'create',
				name: 'Мои сделки',
				parameters
			})
		)
		expect(result.current.canManage).toBe(false)
		expect(getCrmPermissions).not.toHaveBeenCalled()
		expect(mutateSavedView).not.toHaveBeenCalled()
	})
})
