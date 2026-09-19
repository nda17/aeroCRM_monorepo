import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	listSalesDeals,
	listSalesTasks,
	mutateSales,
	type SalesMutation
} from './sales.api'

vi.mock('@/shared/api/authenticated-http-client', async () => ({
	...(await vi.importActual<
		typeof import('@/shared/api/authenticated-http-client')
	>('@/shared/api/authenticated-http-client')),
	authenticatedRequest: vi.fn()
}))
const request = vi.mocked(authenticatedRequest)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const pipelineId = '44444444-4444-4444-8444-444444444444'
const stageId = '55555555-5555-4555-8555-555555555555'
const contactId = '66666666-6666-4666-8666-666666666666'
const commandId = '77777777-7777-4777-8777-777777777777'
const date = '2026-09-05T10:00:00.000Z'
const nextTask = { title: 'Позвонить', dueAt: date }
const task = {
	id: taskId,
	workspaceId,
	dealId: id,
	version: 1,
	...nextTask,
	status: 'OPEN',
	assignedToSubject: 'actor',
	completedAt: null,
	createdAt: date,
	updatedAt: date
}
const deal = {
	id,
	workspaceId,
	version: 1,
	title: 'Заказ',
	currency: 'RUB',
	amountMinor: 12345,
	pipelineId,
	stageId,
	status: 'OPEN',
	contactId,
	contactName: 'Клиент',
	assignedToSubject: 'actor',
	teamId: null,
	archivedAt: null,
	createdAt: date,
	updatedAt: date,
	nextTask: task
}
const create: SalesMutation = {
	kind: 'create',
	title: ' Заказ ',
	currency: 'RUB',
	amountMinor: 12345,
	pipelineId,
	stageId,
	contactId,
	nextTask
}
const execute = (mutation: SalesMutation) =>
	mutateSales('token', { workspaceId, commandId, mutation })

describe('Sales API request and response binding', () => {
	beforeEach(() => vi.clearAllMocks())
	it.each([undefined, false])(
		'omits the additive flag for the unchanged default request: %s',
		async flag => {
			request.mockResolvedValue({
				schemaVersion: 1,
				page: 1,
				pageSize: 20,
				total: 1,
				items: [deal]
			})
			await listSalesDeals('token', workspaceId, 1, 20, '', '', '', flag)
			expect(request).toHaveBeenCalledExactlyOnceWith({
				accessToken: 'token',
				method: 'GET',
				url: '/crm/sales/deals',
				params: { workspaceId, page: '1', pageSize: '20', search: '' }
			})
		}
	)
	it('sends true as an exact query string while preserving all server filters and schema v1', async () => {
		const response = {
			schemaVersion: 1,
			page: 2,
			pageSize: 20,
			total: 21,
			items: [{ ...deal, nextTask: null }]
		}
		request.mockResolvedValue(response)
		await expect(
			listSalesDeals(
				'token',
				workspaceId,
				2,
				20,
				'Заказ',
				pipelineId,
				'OPEN',
				true
			)
		).resolves.toEqual(response)
		expect(request.mock.calls[0][0]).toMatchObject({
			method: 'GET',
			params: {
				workspaceId,
				page: '2',
				pageSize: '20',
				search: 'Заказ',
				pipelineId,
				status: 'OPEN',
				withoutNextAction: 'true'
			}
		})
	})
	it.each(['false', 'true', 1, null, {}])(
		'rejects a non-boolean filter without issuing HTTP: %p',
		async flag => {
			await expect(
				listSalesDeals(
					'token',
					workspaceId,
					1,
					20,
					'',
					'',
					'',
					flag as boolean
				)
			).rejects.toMatchObject({ kind: 'temporary' })
			expect(request).not.toHaveBeenCalled()
		}
	)
	it.each([
		{ ...deal, status: 'WON', nextTask: null },
		{ ...deal, status: 'LOST', nextTask: null },
		deal,
		{ ...deal, nextTask: { ...task, status: 'IN_PROGRESS' } },
		{ ...deal, workspaceId: id, nextTask: null },
		{ ...deal, archivedAt: date, nextTask: null }
	])(
		'rejects rows outside the confirmed without-action response contract',
		async row => {
			request.mockResolvedValue({
				schemaVersion: 1,
				page: 1,
				pageSize: 20,
				total: 1,
				items: [row]
			})
			await expect(
				listSalesDeals('token', workspaceId, 1, 20, '', '', '', true)
			).rejects.toMatchObject({ kind: 'temporary' })
		}
	)
	it('accepts an empty contradictory closed-status result without ignoring the status', async () => {
		const response = {
			schemaVersion: 1,
			page: 1,
			pageSize: 20,
			total: 0,
			items: []
		}
		request.mockResolvedValue(response)
		await expect(
			listSalesDeals('token', workspaceId, 1, 20, '', '', 'LOST', true)
		).resolves.toEqual(response)
		expect(request.mock.calls[0][0].params).toMatchObject({
			status: 'LOST',
			withoutNextAction: 'true'
		})
	})
	it('rejects an open row if the server ignored the contradictory requested status', async () => {
		request.mockResolvedValue({
			schemaVersion: 1,
			page: 1,
			pageSize: 20,
			total: 1,
			items: [{ ...deal, nextTask: null }]
		})
		await expect(
			listSalesDeals('token', workspaceId, 1, 20, '', '', 'WON', true)
		).rejects.toMatchObject({ kind: 'temporary' })
	})
	it('sends exact create fields and ties Idempotency-Key to commandId', async () => {
		request.mockResolvedValue({ schemaVersion: 1, deal })
		await expect(execute(create)).resolves.toEqual(deal)
		expect(request).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/sales/deals',
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				title: ' Заказ ',
				currency: 'RUB',
				amountMinor: 12345,
				pipelineId,
				stageId,
				contactId,
				nextTask
			}
		})
	})
	it.each([
		{ ...deal, title: 'Другая' },
		{ ...deal, version: 2 },
		{ ...deal, contactId: id },
		{ ...deal, amountMinor: 12346 },
		{ ...deal, nextTask: { ...task, title: 'Другое действие' } },
		{ ...deal, nextTask: { ...task, dueAt: '2026-09-06T10:00:00.000Z' } }
	])(
		'rejects a successful create response for different submitted fields',
		async response => {
			request.mockResolvedValue({ schemaVersion: 1, deal: response })
			await expect(execute(create)).rejects.toMatchObject({
				kind: 'temporary'
			})
		}
	)
	it('requires transition CAS version and no next task for closed outcome', async () => {
		const transition: SalesMutation = {
			kind: 'transition',
			id,
			expectedVersion: 1,
			targetStageId: stageId,
			outcome: 'Продано'
		}
		request.mockResolvedValue({
			schemaVersion: 1,
			deal: { ...deal, version: 2, status: 'WON', nextTask: null }
		})
		await expect(execute(transition)).resolves.toMatchObject({
			status: 'WON',
			version: 2
		})
		request.mockResolvedValue({
			schemaVersion: 1,
			deal: { ...deal, version: 2 }
		})
		await expect(execute(transition)).rejects.toMatchObject({
			kind: 'temporary'
		})
		request.mockResolvedValue({
			schemaVersion: 1,
			deal: { ...deal, version: 3, status: 'WON', nextTask: null }
		})
		await expect(execute(transition)).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
	it('requires archive acknowledgment and exact incremented version', async () => {
		const archive: SalesMutation = {
			kind: 'archive',
			id,
			expectedVersion: 1
		}
		request.mockResolvedValue({
			schemaVersion: 1,
			deal: { ...deal, version: 2, archivedAt: date, nextTask: null }
		})
		await expect(execute(archive)).resolves.toMatchObject({
			archivedAt: date
		})
		request.mockResolvedValue({
			schemaVersion: 1,
			deal: { ...deal, version: 3, archivedAt: date, nextTask: null }
		})
		await expect(execute(archive)).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
	it('completes a task using task CAS and never sends local dealId as a DTO field', async () => {
		const mutation: SalesMutation = {
			kind: 'complete',
			id: taskId,
			dealId: id,
			expectedVersion: 1,
			outcome: 'Обсудили',
			nextTask
		}
		request.mockResolvedValue({
			schemaVersion: 1,
			deal: { ...deal, version: 2, nextTask: { ...task, id: commandId } }
		})
		await execute(mutation)
		expect(request.mock.calls[0][0]).toMatchObject({
			url: `/crm/sales/tasks/${taskId}/complete`,
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				expectedVersion: 1,
				outcome: 'Обсудили',
				nextTask
			}
		})
		expect(request.mock.calls[0][0].data).not.toHaveProperty('dealId')
		expect(request.mock.calls[0][0].data).not.toHaveProperty('id')
		request.mockResolvedValue({
			schemaVersion: 1,
			deal: { ...deal, version: 2 }
		})
		await expect(execute(mutation)).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
	it('sends server pagination and excludes archived deals / completed tasks', async () => {
		const page = { schemaVersion: 1, page: 2, pageSize: 20, total: 21 }
		request.mockResolvedValue({ ...page, items: [deal] })
		await listSalesDeals(
			'token',
			workspaceId,
			2,
			20,
			'Заказ',
			pipelineId,
			'OPEN'
		)
		expect(request.mock.calls[0][0].params).toEqual({
			workspaceId,
			page: '2',
			pageSize: '20',
			search: 'Заказ',
			pipelineId,
			status: 'OPEN'
		})
		request.mockResolvedValue({
			...page,
			items: [{ ...deal, archivedAt: date, nextTask: null }]
		})
		await expect(
			listSalesDeals('token', workspaceId, 2, 20, '', '', '')
		).rejects.toMatchObject({ kind: 'temporary' })
		request.mockResolvedValue({
			...page,
			items: [{ ...task, status: 'COMPLETED', completedAt: date }]
		})
		await expect(
			listSalesTasks('token', workspaceId, 2, 20, '')
		).rejects.toMatchObject({ kind: 'temporary' })
	})
})

describe('Sales list analytics drill-down', () => {
	const filters = {
		stageId,
		assignedToSubject: 'actor',
		overdue: true,
		overdueBefore: '2026-09-14T09:00:00.000Z',
		createdFrom: '2026-09-01T00:00:00.000Z',
		createdTo: '2026-09-08T00:00:00.000Z',
		sort: 'next_action_asc' as const
	}
	it('passes exact server filters for the selected stage/employee/creation cohort and retains pagination', async () => {
		request.mockResolvedValue({
			schemaVersion: 1,
			page: 2,
			pageSize: 20,
			total: 21,
			items: [deal]
		})
		await listSalesDeals(
			'token',
			workspaceId,
			2,
			20,
			'',
			pipelineId,
			'OPEN',
			false,
			filters
		)
		expect(request).toHaveBeenLastCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/sales/deals',
			params: {
				workspaceId,
				page: '2',
				pageSize: '20',
				search: '',
				pipelineId,
				status: 'OPEN',
				...filters,
				overdue: 'true'
			}
		})
	})
	it.each([
		{ ...deal, assignedToSubject: 'other' },
		{ ...deal, stageId: id },
		{ ...deal, createdAt: '2026-08-31T23:59:59.999Z' },
		{ ...deal, createdAt: '2026-09-08T00:00:00.000Z' },
		{ ...deal, status: 'WON', nextTask: null }
	])(
		'rejects returned rows outside requested report bounds',
		async row => {
			request.mockResolvedValue({
				schemaVersion: 1,
				page: 1,
				pageSize: 20,
				total: 1,
				items: [row]
			})
			await expect(
				listSalesDeals(
					'token',
					workspaceId,
					1,
					20,
					'',
					'',
					'',
					false,
					filters
				)
			).rejects.toMatchObject({ kind: 'temporary' })
		}
	)
})
