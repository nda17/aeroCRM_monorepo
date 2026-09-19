import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLayoutEffect, useRef, type PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { getAssigneeLabels } from '../api/assignee-labels.api'
import {
	parseAssigneeLabels,
	validAssigneeLabelsRequest,
	type AssigneeLabelsRequest
} from './assignee-labels.contract'
import { useAssigneeLabels } from './use-assignee-labels'
import type { AssigneeDirectoryContext } from './use-assignee-options'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
const uuid = (n: number) =>
	`11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
const request: AssigneeLabelsRequest = {
	workspaceId: uuid(99),
	subject: 'owner',
	dataScope: 'ALL',
	bindings: [{ subject: 'person', membershipId: uuid(1) }]
}
const response = (input = request) => ({
	schemaVersion: 1,
	workspaceId: input.workspaceId,
	subject: input.subject,
	items: input.bindings.map(binding => ({
		binding: { ...binding },
		employee: {
			subject: binding.subject,
			membershipId: binding.membershipId ?? uuid(1),
			displayName: 'Иван Петров',
			verifiedEmail: null,
			role: 'MANAGER'
		}
	}))
})
let client: QueryClient
const current = vi.fn(() => true)
let context: AssigneeDirectoryContext
const wrapper = ({ children }: PropsWithChildren) => (
	<QueryClientProvider client={client}>{children}</QueryClientProvider>
)
beforeEach(() => {
	vi.clearAllMocks()
	current.mockReturnValue(true)
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	context = {
		workspaceId: request.workspaceId,
		subject: request.subject,
		sessionRevision: 1,
		accessToken: 'memory-token',
		canRead: true,
		isCurrent: current,
		authority: {
			workspaceId: request.workspaceId,
			subject: request.subject,
			dataScope: 'ALL',
			role: 'OWNER',
			state: 'ACTIVE',
			teamIds: [],
			permissions: ['sales:read']
		}
	}
	vi.mocked(authenticatedRequest).mockResolvedValue(response())
})
afterEach(() => {
	cleanup()
	client.clear()
})

describe('assignee label batch contract', () => {
	it('keeps legacy null unchanged and validates the exact current membership for non-null bindings', () => {
		const legacy = {
			...request,
			bindings: [{ subject: 'person', membershipId: null }]
		}
		expect(
			parseAssigneeLabels(response(legacy), legacy)?.items[0]?.binding
				.membershipId
		).toBeNull()
		const wrong = response()
		wrong.items[0]!.employee.membershipId = uuid(2)
		expect(parseAssigneeLabels(wrong, request)).toBeNull()
	})
	it.each(['workspaceId', 'subject', 'schemaVersion', 'extra'])(
		'rejects mismatched envelope %s',
		field => {
			expect(
				parseAssigneeLabels({ ...response(), [field]: 'other' }, request)
			).toBeNull()
		}
	)
	it.each([
		undefined,
		{},
		{ employee: null },
		{ binding: request.bindings[0], employee: undefined },
		{ binding: request.bindings[0], employee: {} }
	])('rejects malformed rows safely (%j)', row => {
		expect(
			parseAssigneeLabels({ ...response(), items: [row] }, request)
		).toBeNull()
	})
	it('rejects omitted and duplicate bindings', () => {
		expect(
			parseAssigneeLabels({ ...response(), items: [] }, request)
		).toBeNull()
		const two = {
			...request,
			bindings: [
				...request.bindings,
				{ subject: 'other', membershipId: uuid(2) }
			]
		}
		expect(
			parseAssigneeLabels(
				{
					...response(),
					items: [response().items[0], response().items[0]]
				},
				two
			)
		).toBeNull()
	})
	it('accepts confirmed unavailable without a fabricated employee', () => {
		expect(
			parseAssigneeLabels(
				{
					...response(),
					items: [{ binding: request.bindings[0], employee: null }]
				},
				request
			)?.items[0]?.employee
		).toBeNull()
	})
	it('rejects directory details outside OWN and OWNER outside TEAM', () => {
		expect(
			parseAssigneeLabels(response(), { ...request, dataScope: 'OWN' })
		).toBeNull()
		const owner = response()
		owner.items[0]!.employee.role = 'OWNER'
		expect(
			parseAssigneeLabels(owner, { ...request, dataScope: 'TEAM' })
		).toBeNull()
	})
	it('rejects contradictory current names for one subject across legacy and exact bindings', () => {
		const two = {
			...request,
			bindings: [
				...request.bindings,
				{ subject: 'person', membershipId: null }
			]
		}
		const wrong = response(two)
		wrong.items[1]!.employee.displayName = 'Другой человек'
		expect(parseAssigneeLabels(wrong, two)).toBeNull()
	})
	it('bounds reads to 100 distinct exact pairs and rejects malformed input', () => {
		expect(validAssigneeLabelsRequest({ ...request, bindings: [] })).toBe(
			false
		)
		expect(
			validAssigneeLabelsRequest({
				...request,
				bindings: [...request.bindings, ...request.bindings]
			})
		).toBe(false)
		expect(
			validAssigneeLabelsRequest({
				...request,
				bindings: Array.from({ length: 101 }, (_, n) => ({
					subject: `person${n}`,
					membershipId: uuid(n)
				}))
			})
		).toBe(false)
		expect(
			validAssigneeLabelsRequest({
				...request,
				bindings: [{ subject: 'person', membershipId: 'fake' }]
			})
		).toBe(false)
	})
})

describe('assignee batch transport and query', () => {
	it('sends a read POST with no local authority or command ID', async () => {
		await getAssigneeLabels('memory-token', request)
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'memory-token',
			method: 'POST',
			url: '/crm/access/team/assignee-labels',
			data: {
				schemaVersion: 1,
				workspaceId: request.workspaceId,
				bindings: request.bindings
			}
		})
	})
	it('guards a deep captured request and rejects late aborted responses', async () => {
		let finish!: (value: unknown) => void
		vi.mocked(authenticatedRequest).mockReturnValue(
			new Promise(resolve => {
				finish = resolve
			})
		)
		const input = {
			...request,
			bindings: request.bindings.map(binding => ({ ...binding }))
		}
		const signal = new AbortController()
		const pending = getAssigneeLabels('memory-token', input, signal.signal)
		input.bindings[0]!.subject = 'other'
		expect(
			vi.mocked(authenticatedRequest).mock.calls[0]?.[0].data
		).toEqual({
			schemaVersion: 1,
			workspaceId: request.workspaceId,
			bindings: request.bindings
		})
		signal.abort()
		finish(response())
		await expect(pending).rejects.toMatchObject({ kind: 'temporary' })
	})
	it('reads 20 distinct names in one batch and deduplicates repeated card bindings', async () => {
		const bindings = Array.from({ length: 20 }, (_, n) => ({
			subject: `person${n}`,
			membershipId: uuid(n)
		}))
		vi.mocked(authenticatedRequest).mockResolvedValue(
			response({ ...request, bindings })
		)
		const { result } = renderHook(
			() => useAssigneeLabels(context, [...bindings, bindings[0]!]),
			{ wrapper }
		)
		await waitFor(() =>
			expect(result.current.lookup(bindings[0]!)).toBeTruthy()
		)
		expect(authenticatedRequest).toHaveBeenCalledTimes(1)
		expect(
			JSON.stringify(
				client
					.getQueryCache()
					.getAll()
					.map(query => query.queryKey)
			)
		).not.toContain('memory-token')
	})
	it('does not start an empty or unauthorized lookup', () => {
		renderHook(() => useAssigneeLabels(context, []), { wrapper })
		renderHook(
			() =>
				useAssigneeLabels(
					{ ...context, canRead: false },
					request.bindings
				),
			{ wrapper }
		)
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('hides cached labels during a permission refresh and recovers after it', async () => {
		const { result, rerender } = renderHook(
			() => useAssigneeLabels(context, request.bindings),
			{ wrapper }
		)
		await waitFor(() =>
			expect(result.current.lookup(request.bindings[0]!)).toBeTruthy()
		)
		context = { ...context, canRead: false }
		rerender()
		expect(result.current.lookup(request.bindings[0]!)).toBeUndefined()
		context = { ...context, canRead: true }
		rerender()
		await waitFor(() =>
			expect(result.current.lookup(request.bindings[0]!)).toBeTruthy()
		)
	})
	it('resumes reads when a parent live canRead guard catches up in a layout effect', async () => {
		const { result, rerender } = renderHook(
			({ canRead }) => {
				const live = useRef(canRead)
				useLayoutEffect(() => {
					live.current = canRead
				}, [canRead])
				return useAssigneeLabels(
					{ ...context, canRead, isCurrent: () => live.current },
					request.bindings
				)
			},
			{ wrapper, initialProps: { canRead: true } }
		)
		await waitFor(() =>
			expect(result.current.lookup(request.bindings[0]!)).toBeTruthy()
		)
		rerender({ canRead: false })
		expect(result.current.lookup(request.bindings[0]!)).toBeUndefined()
		rerender({ canRead: true })
		await waitFor(() =>
			expect(authenticatedRequest).toHaveBeenCalledTimes(2)
		)
		await waitFor(() =>
			expect(result.current.lookup(request.bindings[0]!)).toBeTruthy()
		)
	})
	it('does not expose an old captured lookup if live authority is revoked before a rerender', async () => {
		const { result } = renderHook(
			() => useAssigneeLabels(context, request.bindings),
			{ wrapper }
		)
		await waitFor(() =>
			expect(result.current.lookup(request.bindings[0]!)).toBeTruthy()
		)
		const lookup = result.current.lookup
		current.mockReturnValue(false)
		expect(lookup(request.bindings[0]!)).toBeUndefined()
	})
	it('rejects a same-actor old-session response and keeps only the new revision label', async () => {
		let finish!: (value: unknown) => void
		vi.mocked(authenticatedRequest).mockReturnValueOnce(
			new Promise(resolve => {
				finish = resolve
			})
		)
		const { result, rerender } = renderHook(
			() => useAssigneeLabels(context, request.bindings),
			{ wrapper }
		)
		await waitFor(() =>
			expect(authenticatedRequest).toHaveBeenCalledTimes(1)
		)
		const fresh = response()
		fresh.items[0]!.employee.displayName = 'Новая сессия'
		vi.mocked(authenticatedRequest).mockResolvedValue(fresh)
		context = { ...context, sessionRevision: 2, accessToken: 'new-token' }
		rerender()
		await waitFor(() =>
			expect(
				result.current.lookup(request.bindings[0]!)?.employee?.displayName
			).toBe('Новая сессия')
		)
		await act(async () => finish(response()))
		expect(
			result.current.lookup(request.bindings[0]!)?.employee?.displayName
		).toBe('Новая сессия')
	})
	it('aborts the observer logically on unmount and does not retain the late PII result', async () => {
		let finish!: (value: unknown) => void
		vi.mocked(authenticatedRequest).mockReturnValueOnce(
			new Promise(resolve => {
				finish = resolve
			})
		)
		const { unmount } = renderHook(
			() => useAssigneeLabels(context, request.bindings),
			{ wrapper }
		)
		await waitFor(() =>
			expect(authenticatedRequest).toHaveBeenCalledTimes(1)
		)
		unmount()
		await act(async () => finish(response()))
		await waitFor(() =>
			expect(client.getQueryCache().getAll().length).toBe(0)
		)
	})
	it('returns a distinct outage, never a confirmed missing employee', async () => {
		vi.mocked(authenticatedRequest).mockRejectedValue(new Error('Offline'))
		const { result } = renderHook(
			() => useAssigneeLabels(context, request.bindings),
			{ wrapper }
		)
		await waitFor(() => expect(result.current.error).toBe(true))
		expect(result.current.lookup(request.bindings[0]!)).toBeUndefined()
	})
	it('rejects an in-flight response after losing current authority', async () => {
		vi.mocked(authenticatedRequest).mockImplementation(async () => {
			current.mockReturnValue(false)
			return response()
		})
		const { result } = renderHook(
			() => useAssigneeLabels(context, request.bindings),
			{ wrapper }
		)
		await waitFor(() =>
			expect(authenticatedRequest).toHaveBeenCalledOnce()
		)
		expect(result.current.lookup(request.bindings[0]!)).toBeUndefined()
	})
})
