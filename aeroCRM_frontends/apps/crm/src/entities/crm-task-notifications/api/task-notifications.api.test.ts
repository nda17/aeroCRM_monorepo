import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	listTaskNotifications,
	parseTaskNotifications,
	setTaskNotificationRead
} from './task-notifications.api'
vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
const id = '11111111-1111-4111-8111-111111111111',
	workspaceId = '22222222-2222-4222-8222-222222222222'
const request = {
	workspaceId,
	actorMembershipId: null,
	page: 1,
	pageSize: 10,
	unreadOnly: false
}
const item = {
	id,
	kind: 'ASSIGNED',
	taskId: id,
	title: 'Task',
	dueAt: '2026-09-08T12:00:00.000Z',
	createdAt: '2026-09-08T11:00:00.000Z',
	readAt: null,
	href: `/planner?task=${id}`
}
const page = {
	schemaVersion: 1,
	workspaceId,
	page: 1,
	pageSize: 10,
	total: 1,
	unreadCount: 1,
	items: [item]
}
beforeEach(() => vi.clearAllMocks())
describe('task notification transport contract', () => {
	it('uses server paging and exact optional actor binding', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(page)
		expect(await listTaskNotifications('token', request)).toEqual(page)
		expect(vi.mocked(authenticatedRequest).mock.calls[0][0]).toMatchObject(
			{
				method: 'GET',
				url: '/crm/sales/notifications',
				params: {
					workspaceId,
					page: '1',
					pageSize: '10',
					unreadOnly: 'false'
				}
			}
		)
		await listTaskNotifications('token', {
			...request,
			actorMembershipId: id
		})
		expect(
			vi.mocked(authenticatedRequest).mock.calls[1][0].params
				?.actorMembershipId
		).toBe(id)
	})
	it.each([
		{ href: 'https://evil.test/' },
		{ href: '/planner?task=other' },
		{ kind: 'UNKNOWN' },
		{ taskId: 'bad' },
		{ title: 'a'.repeat(201) },
		{ readAt: 'bad' },
		{ other: 'PII' }
	])('rejects untrusted notification %j', patch => {
		expect(
			parseTaskNotifications(
				{ ...page, items: [{ ...item, ...patch }] },
				request
			)
		).toBeNull()
	})
	it('rejects scope drift, inconsistent counters/pages and duplicated records', () => {
		for (const patch of [
			{ workspaceId: id },
			{ page: 2 },
			{ total: 2 },
			{ unreadCount: 2 },
			{ total: 2, items: [item, item] }
		])
			expect(
				parseTaskNotifications({ ...page, ...patch }, request)
			).toBeNull()
	})
	it('uses idempotent PUT read-state without claiming a mismatched result', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			id,
			readAt: item.createdAt
		})
		await setTaskNotificationRead('token', { ...request, id, read: true })
		expect(authenticatedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'PUT',
				url: `/crm/sales/notifications/${id}/read`,
				data: { workspaceId, actorMembershipId: null, read: true }
			})
		)
		await expect(
			setTaskNotificationRead('token', { ...request, id, read: false })
		).rejects.toThrow()
	})
})
