import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import {
	authenticatedRequest,
	AuthenticatedApiError
} from '@/shared/api/authenticated-http-client'
import {
	freezeWorkdayCommand,
	getWorkdayTask,
	listWorkdayTasks,
	listWorkdayTimeline,
	mutateWorkdayTask
} from './workday.api'
import {
	binding,
	command,
	commandId,
	date,
	entry,
	filters,
	membershipId,
	otherId,
	page,
	task,
	taskId,
	workspaceId
} from '../model/workday.test-fixtures'
import type { WorkdayMutation } from '../model/workday.types'

vi.mock('@/shared/api/authenticated-http-client', async () => ({
	...(await vi.importActual<
		typeof import('@/shared/api/authenticated-http-client')
	>('@/shared/api/authenticated-http-client')),
	authenticatedRequest: vi.fn()
}))
const request = vi.mocked(authenticatedRequest)
beforeEach(() => {
	vi.clearAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'captured', userId: 'actor' })
})

describe('Workday API exact requests and immutable effects', () => {
	it.each([
		[
			'crm_task_version_conflict',
			'Задача уже изменилась. Обновите данные и повторите изменение.'
		],
		[
			'crm_task_deal_closed',
			'Связанная сделка закрыта. Сначала верните сделку в работу, затем измените задачу.'
		],
		[
			'crm_task_command_conflict',
			'Этот запрос уже обработан с другими параметрами. Обновите данные задачи.'
		]
	])(
		'maps the safe task error code %s without exposing upstream text',
		async (code, message) => {
			request.mockResolvedValue({ schemaVersion: 1, task })
			await mutateWorkdayTask('captured', command)
			const mapper = request.mock.calls[0][0].mapError!
			expect(
				mapper({
					isAxiosError: true,
					response: {
						status: 409,
						data: { code, message: 'private upstream data' }
					}
				})?.message
			).toBe(message)
			expect(
				mapper({
					isAxiosError: true,
					response: {
						status: 409,
						data: { code: 'unknown', message: 'private' }
					}
				})
			).toBeUndefined()
			expect(
				mapper({
					isAxiosError: true,
					response: { status: 403, data: { code } }
				})
			).toBeUndefined()
		}
	)
	it('sends explicit server period/timezone, scope and pagination without local actor fields', async () => {
		request.mockResolvedValue(page)
		await expect(
			listWorkdayTasks('captured', { ...binding, ...filters })
		).resolves.toEqual(page)
		expect(request).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'captured',
			method: 'GET',
			url: '/crm/sales/workday/tasks',
			params: {
				workspaceId,
				page: '1',
				pageSize: '20',
				period: 'TODAY',
				scope: 'MINE',
				timeZone: 'Europe/Moscow'
			}
		})
	})
	it('sends custom range and server-side assignee/team filters', async () => {
		request.mockResolvedValue({
			...page,
			range: {
				from: '2026-09-06T21:00:00.000Z',
				until: '2026-09-09T21:00:00.000Z'
			},
			items: [{ ...task, teamId: otherId }]
		})
		await listWorkdayTasks('captured', {
			...binding,
			...filters,
			scope: 'TEAM',
			period: 'RANGE',
			from: '2026-09-07',
			to: '2026-09-09',
			assigneeSubject: 'actor',
			teamId: otherId,
			search: 'Позвонить',
			status: 'OPEN'
		})
		expect(request.mock.calls[0][0].params).toMatchObject({
			from: '2026-09-07',
			to: '2026-09-09',
			assigneeSubject: 'actor',
			teamId: otherId,
			search: 'Позвонить',
			status: 'OPEN'
		})
	})
	it('reads exact detail and paginated timeline paths', async () => {
		request
			.mockResolvedValueOnce({ schemaVersion: 1, task })
			.mockResolvedValueOnce({
				schemaVersion: 1,
				page: 2,
				pageSize: 25,
				total: 26,
				items: [entry]
			})
		await expect(
			getWorkdayTask('captured', { ...binding, id: taskId })
		).resolves.toEqual(task)
		await listWorkdayTimeline('captured', {
			...binding,
			id: taskId,
			page: 2,
			pageSize: 25
		})
		expect(request.mock.calls[0][0]).toMatchObject({
			method: 'GET',
			url: `/crm/sales/workday/tasks/${taskId}`,
			params: { workspaceId }
		})
		expect(request.mock.calls[1][0]).toMatchObject({
			method: 'GET',
			url: `/crm/sales/workday/tasks/${taskId}/timeline`,
			params: { workspaceId, page: '2', pageSize: '25' }
		})
	})
	it('creates standalone tasks with explicit assignee binding and omits nullable relationship fields', async () => {
		request.mockResolvedValue({ schemaVersion: 1, task })
		await expect(mutateWorkdayTask('captured', command)).resolves.toEqual(
			task
		)
		expect(request).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'captured',
			method: 'POST',
			url: '/crm/sales/workday/tasks',
			headers: { 'Idempotency-Key': commandId },
			mapError: expect.any(Function),
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				title: task.title,
				dueAt: date,
				assignee: { subject: 'actor', membershipId }
			}
		})
	})
	it('creates linked tasks without inventing deal ownership or membership data', async () => {
		const mutation = {
			...command.mutation,
			kind: 'create' as const,
			title: task.title,
			dueAt: date,
			assignee: { subject: 'actor', membershipId },
			dealId: otherId,
			teamId: null
		}
		request.mockResolvedValue({
			schemaVersion: 1,
			task: { ...task, dealId: otherId, teamId: otherId }
		})
		await mutateWorkdayTask('captured', { ...command, mutation })
		expect(request.mock.calls[0][0].data).toMatchObject({
			dealId: otherId
		})
		expect(request.mock.calls[0][0].data).not.toHaveProperty('teamId')
	})
	it.each([
		{
			kind: 'edit',
			id: taskId,
			expectedVersion: 1,
			title: 'Новая задача',
			dueAt: date
		},
		{
			kind: 'status',
			id: taskId,
			expectedVersion: 1,
			status: 'IN_PROGRESS'
		},
		{
			kind: 'assignee',
			id: taskId,
			expectedVersion: 1,
			assignee: { subject: 'other', membershipId: otherId }
		}
	] as WorkdayMutation[])(
		'uses isolated $kind command endpoint with CAS, not old complete semantics',
		async mutation => {
			const updated = {
				...task,
				version: 2,
				...(mutation.kind === 'edit'
					? { title: mutation.title }
					: mutation.kind === 'status'
						? { status: mutation.status }
						: mutation.kind === 'assignee'
							? {
									assignedToSubject: mutation.assignee.subject,
									assignedToMembershipId: mutation.assignee.membershipId
								}
							: {})
			}
			request.mockResolvedValue({ schemaVersion: 1, task: updated })
			await mutateWorkdayTask('captured', { ...command, mutation })
			expect(request.mock.calls[0][0]).toMatchObject({
				accessToken: 'captured',
				method: 'POST',
				url: `/crm/sales/workday/tasks/${taskId}/${mutation.kind}`,
				headers: { 'Idempotency-Key': commandId },
				data: {
					schemaVersion: 1,
					workspaceId,
					commandId,
					expectedVersion: 1
				}
			})
			for (const key of [
				'kind',
				'id',
				'subject',
				'sessionRevision',
				'mutation',
				'nextTask'
			])
				expect(request.mock.calls[0][0].data).not.toHaveProperty(key)
		}
	)
	it('copies and freezes nested assignee fields for the same UUID retry', () => {
		const pending = freezeWorkdayCommand(command)
		expect(pending).not.toBe(command)
		expect(Object.isFrozen(pending)).toBe(true)
		expect(Object.isFrozen(pending.mutation)).toBe(true)
		if (pending.mutation.kind === 'create')
			expect(Object.isFrozen(pending.mutation.assignee)).toBe(true)
	})
	it('does not refresh/replay automatically after 401 and rejects another current actor before POST', async () => {
		request.mockImplementation(async () => {
			useSessionStore
				.getState()
				.setAuthenticated({ accessToken: 'other-token', userId: 'other' })
			throw new AuthenticatedApiError('unauthorized', 'Expired')
		})
		await expect(
			mutateWorkdayTask('captured', command)
		).rejects.toMatchObject({ kind: 'unauthorized' })
		expect(request).toHaveBeenCalledTimes(1)
		await expect(
			mutateWorkdayTask('other-token', command)
		).rejects.toMatchObject({ kind: 'unauthorized' })
		expect(request).toHaveBeenCalledTimes(1)
	})
	it('rejects the same actor after new authentication even if token happens to match', async () => {
		useSessionStore
			.getState()
			.setAuthenticated({ accessToken: 'captured', userId: 'actor' })
		await expect(
			mutateWorkdayTask('captured', command)
		).rejects.toMatchObject({ kind: 'unauthorized' })
		expect(request).not.toHaveBeenCalled()
	})
	it('preserves exact UUID/payload across an explicit unknown-result retry', async () => {
		request
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown')
			)
			.mockResolvedValueOnce({ schemaVersion: 1, task })
		const pending = freezeWorkdayCommand(command)
		await expect(
			mutateWorkdayTask('captured', pending)
		).rejects.toMatchObject({ kind: 'temporary' })
		await expect(mutateWorkdayTask('captured', pending)).resolves.toEqual(
			task
		)
		expect(request.mock.calls[1][0]).toEqual(request.mock.calls[0][0])
	})
	it('rejects malformed responses as unknown rather than claiming write failure or success', async () => {
		request.mockResolvedValue({
			schemaVersion: 1,
			task: { ...task, assignedToSubject: 'other' }
		})
		await expect(
			mutateWorkdayTask('captured', command)
		).rejects.toMatchObject({ kind: 'temporary' })
	})
	it('rejects bad paths/filter parameters before any HTTP request', async () => {
		await expect(
			getWorkdayTask('captured', { ...binding, id: '../another' })
		).rejects.toMatchObject({ kind: 'validation' })
		await expect(
			listWorkdayTasks('captured', {
				...binding,
				...filters,
				timeZone: ''
			})
		).rejects.toMatchObject({ kind: 'validation' })
		await expect(
			listWorkdayTimeline('captured', {
				...binding,
				id: taskId,
				page: 0,
				pageSize: 25
			})
		).rejects.toMatchObject({ kind: 'validation' })
		expect(request).not.toHaveBeenCalled()
	})
})
