import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import type { useWorkdaySession } from '@/entities/crm-workday'
import {
	membershipId,
	otherId,
	task,
	workspaceId
} from '@/entities/crm-workday/model/workday.test-fixtures'
import { getSalesDeal, type SalesDeal } from '@/entities/sales'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	WorkdayNextTaskSuggestion,
	type WorkdayCompletion
} from './WorkdayNextTaskSuggestion'

vi.mock('@/entities/sales', async () => ({
	...(await vi.importActual<typeof import('@/entities/sales')>(
		'@/entities/sales'
	)),
	getSalesDeal: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { error: vi.fn() })
}))
type Context = ReturnType<typeof useWorkdaySession>
let context: Context
let completion: WorkdayCompletion
let onCreate = vi.fn<(deal: SalesDeal | null) => boolean | void>()
let onDismiss = vi.fn<() => void>()
const deal: SalesDeal = {
	id: otherId,
	workspaceId,
	version: 1,
	title: 'Открытая сделка',
	currency: 'RUB',
	amountMinor: 0,
	pipelineId: membershipId,
	stageId: task.id,
	status: 'OPEN',
	contactId: membershipId,
	contactName: 'Контакт',
	assignedToSubject: 'colleague',
	teamId: null,
	archivedAt: null,
	createdAt: task.createdAt,
	updatedAt: task.updatedAt,
	nextTask: null
}
const deferred = <T,>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>(done => {
		resolve = done
	})
	return { promise, resolve }
}
const props = () => ({ completion, context, onCreate, onDismiss })
const button = () =>
	screen.getByRole('button', { name: 'Следующая задача' })
beforeEach(() => {
	vi.resetAllMocks()
	onCreate = vi.fn()
	onDismiss = vi.fn()
	context = {
		workspace: { workspaceId, canWrite: true },
		session: { userId: 'actor', accessToken: 'token' },
		sessionRevision: 3,
		scopeKey: 'scope',
		canRead: true,
		canWrite: true,
		current: vi.fn(() => true),
		authorize: vi.fn(async () => 'token')
	} as unknown as Context
	completion = {
		scopeKey: 'scope',
		task: {
			...task,
			version: 2,
			status: 'COMPLETED',
			completedAt: task.dueAt
		},
		command: {
			workspaceId,
			subject: 'actor',
			sessionRevision: 3,
			commandId: membershipId,
			mutation: {
				kind: 'status',
				id: task.id,
				expectedVersion: 1,
				status: 'COMPLETED'
			}
		}
	}
	vi.mocked(getSalesDeal).mockResolvedValue(deal)
})
afterEach(cleanup)

describe('optional confirmed next task', () => {
	it('does no prefetch, authorization or creation until explicitly selected; dismissal needs no mutation', () => {
		render(<WorkdayNextTaskSuggestion {...props()} />)
		expect(
			screen.getByRole('region', { name: 'Следующий шаг' })
		).toBeTruthy()
		expect(getSalesDeal).not.toHaveBeenCalled()
		expect(context.authorize).not.toHaveBeenCalled()
		expect(onCreate).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }))
		expect(onDismiss).toHaveBeenCalledTimes(1)
		expect(onCreate).not.toHaveBeenCalled()
	})
	it('opens a standalone draft only after fresh write authorization', async () => {
		render(<WorkdayNextTaskSuggestion {...props()} />)
		fireEvent.click(button())
		await waitFor(() => expect(onCreate).toHaveBeenCalledWith(null))
		expect(context.authorize).toHaveBeenCalledTimes(1)
		expect(getSalesDeal).not.toHaveBeenCalled()
		fireEvent.click(button())
		expect(onCreate).toHaveBeenCalledTimes(1)
	})
	it('re-reads the exact linked deal, authorizes afterwards, and passes no inherited title, due date or assignee', async () => {
		completion.task = { ...completion.task, dealId: deal.id }
		const read = deferred<SalesDeal>()
		vi.mocked(getSalesDeal).mockReturnValue(read.promise)
		render(<WorkdayNextTaskSuggestion {...props()} />)
		fireEvent.click(button())
		fireEvent.click(button())
		expect(context.authorize).not.toHaveBeenCalled()
		expect(getSalesDeal).toHaveBeenCalledTimes(1)
		expect(getSalesDeal).toHaveBeenCalledWith(
			'token',
			workspaceId,
			deal.id
		)
		await act(async () => read.resolve(deal))
		expect(context.authorize).toHaveBeenCalledTimes(1)
		expect(onCreate).toHaveBeenCalledExactlyOnceWith(deal)
	})
	it.each([
		{
			name: 'edit of a completed task',
			change: () => {
				completion.command.mutation = {
					kind: 'edit',
					id: task.id,
					expectedVersion: 1,
					title: task.title,
					dueAt: task.dueAt
				}
			}
		},
		{
			name: 'cancel',
			change: () => {
				completion.command.mutation = {
					kind: 'status',
					id: task.id,
					expectedVersion: 1,
					status: 'CANCELLED'
				}
			}
		},
		{
			name: 'wrong task',
			change: () => {
				completion.task = { ...completion.task, id: otherId }
			}
		},
		{
			name: 'unconfirmed status',
			change: () => {
				completion.task = { ...completion.task, status: 'OPEN' }
			}
		},
		{
			name: 'wrong CAS version',
			change: () => {
				completion.task = { ...completion.task, version: 4 }
			}
		},
		{
			name: 'wrong workspace',
			change: () => {
				context = {
					...context,
					workspace: { ...context.workspace, workspaceId: otherId }
				}
			}
		},
		{
			name: 'wrong actor',
			change: () => {
				context = {
					...context,
					session: { ...context.session!, userId: 'other' }
				}
			}
		},
		{
			name: 'new same-actor session',
			change: () => {
				context = { ...context, sessionRevision: 4 }
			}
		},
		{
			name: 'new permission scope',
			change: () => {
				context = { ...context, scopeKey: 'new-scope' }
			}
		},
		{
			name: 'read-only',
			change: () => {
				context = { ...context, canWrite: false }
			}
		}
	])('does not offer next creation for $name', ({ change }) => {
		change()
		render(<WorkdayNextTaskSuggestion {...props()} />)
		expect(
			screen.queryByRole('region', { name: 'Следующий шаг' })
		).toBeNull()
		expect(context.authorize).not.toHaveBeenCalled()
	})
	it.each(['disabled', 'not-current'] as const)(
		'blocks a click when %s',
		async condition => {
			if (condition === 'not-current')
				vi.mocked(context.current).mockReturnValue(false)
			render(
				<WorkdayNextTaskSuggestion
					{...props()}
					disabled={condition === 'disabled'}
				/>
			)
			fireEvent.click(button())
			expect(onCreate).not.toHaveBeenCalled()
			expect(context.authorize).not.toHaveBeenCalled()
		}
	)
	it.each([
		{ status: 'WON' as const },
		{ status: 'LOST' as const },
		{ archivedAt: task.dueAt },
		{ workspaceId: membershipId },
		{ id: membershipId }
	])(
		'leaves completion intact if the linked deal is closed/unavailable: %s',
		async changed => {
			completion.task = { ...completion.task, dealId: deal.id }
			vi.mocked(getSalesDeal).mockResolvedValue({ ...deal, ...changed })
			render(<WorkdayNextTaskSuggestion {...props()} />)
			fireEvent.click(button())
			await screen.findByRole('alert')
			expect(onCreate).not.toHaveBeenCalled()
			expect(completion.task.status).toBe('COMPLETED')
			expect(
				screen.getByRole('button', { name: 'Не сейчас' })
			).toHaveProperty('disabled', false)
		}
	)
	it('shows a read outage and can retry without creating any task automatically', async () => {
		completion.task = { ...completion.task, dealId: deal.id }
		vi.mocked(getSalesDeal).mockRejectedValueOnce(new Error('network'))
		render(<WorkdayNextTaskSuggestion {...props()} />)
		fireEvent.click(button())
		await screen.findByRole('alert')
		expect(onCreate).not.toHaveBeenCalled()
		fireEvent.click(button())
		await waitFor(() => expect(onCreate).toHaveBeenCalledWith(deal))
	})
	it('does not open a draft after the server revokes write access', async () => {
		vi.mocked(context.authorize).mockRejectedValue(
			new AuthenticatedApiError('forbidden', 'Права изменились')
		)
		render(<WorkdayNextTaskSuggestion {...props()} />)
		fireEvent.click(button())
		await screen.findByRole('alert')
		expect(onCreate).not.toHaveBeenCalled()
	})
	it.each([
		'dismiss',
		'unmount',
		'workspace',
		'actor',
		'session',
		'scope',
		'readonly',
		'disabled'
	] as const)(
		'discards a delayed read after %s before opening any draft',
		async change => {
			completion.task = { ...completion.task, dealId: deal.id }
			const read = deferred<SalesDeal>()
			vi.mocked(getSalesDeal).mockReturnValue(read.promise)
			const view = render(<WorkdayNextTaskSuggestion {...props()} />)
			fireEvent.click(button())
			if (change === 'dismiss')
				fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }))
			else if (change === 'unmount') view.unmount()
			else {
				context = {
					...context,
					...(change === 'workspace'
						? { workspace: { ...context.workspace, workspaceId: otherId } }
						: {}),
					...(change === 'actor'
						? { session: { ...context.session!, userId: 'other' } }
						: {}),
					...(change === 'session' ? { sessionRevision: 4 } : {}),
					...(change === 'scope' ? { scopeKey: 'new-scope' } : {}),
					...(change === 'readonly' ? { canWrite: false } : {})
				}
				view.rerender(
					<WorkdayNextTaskSuggestion
						{...props()}
						disabled={change === 'disabled'}
					/>
				)
			}
			await act(async () => read.resolve(deal))
			expect(onCreate).not.toHaveBeenCalled()
			expect(context.authorize).not.toHaveBeenCalled()
		}
	)
	it('rechecks the live guard after authorization resolves', async () => {
		const auth = deferred<string>()
		vi.mocked(context.authorize).mockReturnValue(auth.promise)
		render(<WorkdayNextTaskSuggestion {...props()} />)
		fireEvent.click(button())
		vi.mocked(context.current).mockReturnValue(false)
		await act(async () => auth.resolve('token'))
		expect(onCreate).not.toHaveBeenCalled()
	})
	it('does not announce opening if the parent rejects a pending transition', async () => {
		onCreate.mockReturnValue(false)
		render(<WorkdayNextTaskSuggestion {...props()} />)
		fireEvent.click(button())
		await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
		expect(toast).not.toHaveBeenCalled()
	})
})
