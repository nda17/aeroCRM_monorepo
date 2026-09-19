import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	command,
	page,
	request,
	row
} from '../model/task-series.test-fixtures'
import {
	freezeSeriesCommand,
	listTaskSeries,
	mutateTaskSeries
} from './task-series.api'

vi.mock('@/shared/api/authenticated-http-client', async () => ({
	...(await vi.importActual<
		typeof import('@/shared/api/authenticated-http-client')
	>('@/shared/api/authenticated-http-client')),
	authenticatedRequest: vi.fn()
}))
const http = vi.mocked(authenticatedRequest)
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'token', userId: 'actor' })
})
describe('series HTTP requests', () => {
	it('uses server-side pagination, search and status', async () => {
		http.mockResolvedValueOnce(page)
		await listTaskSeries('token', { ...request, search: 'отчёт' })
		expect(http).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'GET',
				url: '/crm/sales/workday/task-series',
				params: {
					workspaceId: row.workspaceId,
					page: '1',
					pageSize: '10',
					status: 'ACTIVE',
					search: 'отчёт'
				}
			})
		)
	})
	it('pins membership and UUID while leaving frequency changes out of the edit body', async () => {
		http.mockResolvedValueOnce({ schemaVersion: 1, series: row })
		await mutateTaskSeries('token', {
			...command,
			sessionRevision: useSessionStore.getState().sessionRevision
		})
		expect(http.mock.calls[0][0].headers).toEqual({
			'Idempotency-Key': command.commandId
		})
		expect(http.mock.calls[0][0].data).toMatchObject({
			actorMembershipId: null,
			content: expect.objectContaining({ assignee: row.assignee }),
			frequency: 'WEEKLY'
		})
		http.mockResolvedValueOnce({
			schemaVersion: 1,
			series: { ...row, version: 2 }
		})
		await mutateTaskSeries('token', {
			...command,
			sessionRevision: useSessionStore.getState().sessionRevision,
			mutation: {
				kind: 'edit',
				id: row.id,
				expectedVersion: 1,
				content: {
					title: row.title,
					localTime: row.localTime,
					timeZone: row.timeZone,
					assignee: row.assignee
				}
			}
		})
		expect(http.mock.calls[1][0].data).not.toHaveProperty('frequency')
		expect(http.mock.calls[1][0].data).not.toHaveProperty('startDate')
	})
	it('does not send stale sessions; captures deep immutable retry content', async () => {
		const frozen = freezeSeriesCommand(command)
		expect(Object.isFrozen(frozen.mutation)).toBe(true)
		if ('content' in frozen.mutation)
			expect(Object.isFrozen(frozen.mutation.content.assignee)).toBe(true)
		await expect(mutateTaskSeries('wrong-token', command)).rejects.toThrow(
			'Сессия изменилась'
		)
		expect(http).not.toHaveBeenCalled()
	})
})
