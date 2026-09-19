import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { listAssigneeOptions } from './assignee-options.api'
import type { AssigneeOptionsRequest } from '../model/assignee-options.contract'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
const request: AssigneeOptionsRequest = {
	workspaceId: '11111111-1111-4111-8111-111111111111',
	subject: 'owner',
	dataScope: 'ALL',
	page: 2,
	pageSize: 20,
	search: 'Петров',
	selectedSubject: 'employee',
	teamId: '22222222-2222-4222-8222-222222222222'
}
const response = {
	schemaVersion: 1,
	workspaceId: request.workspaceId,
	subject: request.subject,
	page: 2,
	pageSize: 20,
	total: 0,
	items: [],
	selected: null
}
beforeEach(() => vi.clearAllMocks())

describe('assignee options HTTP', () => {
	it('uses only supported public query filters and the captured bearer token', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(response)
		await expect(
			listAssigneeOptions('captured-token', request)
		).resolves.toEqual(response)
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'captured-token',
			method: 'GET',
			url: '/crm/access/team/assignees',
			params: {
				workspaceId: request.workspaceId,
				page: '2',
				pageSize: '20',
				search: 'Петров',
				selectedSubject: 'employee',
				teamId: request.teamId
			}
		})
	})
	it('omits absent search, selected and team filters rather than inventing a subject filter', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(response)
		await listAssigneeOptions('token', {
			...request,
			search: '',
			selectedSubject: undefined,
			teamId: undefined
		})
		expect(authenticatedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				params: {
					workspaceId: request.workspaceId,
					page: '2',
					pageSize: '20'
				}
			})
		)
	})
	it('rejects a mismatched actor response and never rebinds to a mutated request', async () => {
		let complete!: (value: unknown) => void
		vi.mocked(authenticatedRequest).mockReturnValue(
			new Promise(resolve => {
				complete = resolve
			})
		)
		const mutable = { ...request }
		const pending = listAssigneeOptions('token', mutable)
		mutable.subject = 'other'
		complete({ ...response, subject: 'other' })
		await expect(pending).rejects.toMatchObject({ kind: 'temporary' })
	})
	it('does not call transport with invalid parameters', async () => {
		await expect(
			listAssigneeOptions('token', { ...request, teamId: 'guessed' })
		).rejects.toMatchObject({ kind: 'temporary' })
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
})
