import {
	getCustomer,
	listCustomers,
	type Customer
} from '@/entities/customer'
import { useSessionStore } from '@/entities/session'
import { getCrmPermissions } from '@/entities/crm-access'
import {
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'
import {
	getSalesDeal,
	getSalesDealContext,
	listSalesTimeline,
	listSalesTimelineV2,
	listSalesTimelineV3,
	listArchivedDealTasks,
	mutateSales,
	type SalesDeal,
	type SalesPipeline
} from '@/entities/sales'
import { listSalesTimelineV4 } from '@/entities/sales/api/sales-productivity.api'
import { useLossReasons } from '@/entities/sales/model/use-loss-reasons'
import {
	addManagedPipelineStage,
	getPipelineStageDurationSettings,
	getPipelineNextActionTemplates,
	listManagedPipelines,
	renameManagedPipeline,
	saveStageDurationLimit,
	saveStageNextActionTemplate
} from '@/entities/sales/api/commerce.api'
import { getPipelineTemplates } from '@/features/crm-access-gate/api/crm-access.api'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSalesSession } from '../model/use-sales-session'
import { CreateDealDrawer, parseRublesToMinor } from './CreateDealDrawer'
import { DealDetailsDrawer } from './DealDetailsDrawer'
import { CompleteTaskDrawer } from './CompleteTaskDrawer'
import { PipelineManager } from './PipelineManager'

vi.mock('@/entities/customer', () => ({
	listCustomers: vi.fn(),
	getCustomer: vi.fn()
}))
vi.mock('@/features/edit-customer', () => ({
	CustomerEditor: ({
		initialName,
		onSaved,
		onClose
	}: {
		initialName: string
		onSaved: (record: Customer) => void
		onClose: () => void
	}) => (
		<section aria-label="Создание контакта внутри сделки">
			<span>{initialName}</span>
			<button
				onClick={() => {
					onSaved({
						...contact,
						id: '88888888-8888-4888-8888-888888888888',
						name: initialName
					})
					onClose()
				}}
			>
				Сохранить нового клиента
			</button>
		</section>
	)
}))
vi.mock('@/entities/crm-access', () => ({ getCrmPermissions: vi.fn() }))
vi.mock('@/entities/crm-planner/model/use-planner-settings', () => ({
	usePlannerSettings: () => ({ context: { canRead: false } })
}))
vi.mock('@/entities/sales/model/use-activity-text-templates', () => ({
	useActivityTextTemplates: () => ({ context: { canRead: false } })
}))
vi.mock('@/entities/sales', () => ({
	getSalesDeal: vi.fn(),
	getSalesDealContext: vi.fn(),
	listSalesTimeline: vi.fn(),
	listSalesTimelineV2: vi.fn(),
	listSalesTimelineV3: vi.fn(),
	listArchivedDealTasks: vi.fn(),
	mutateSales: vi.fn()
}))
vi.mock('@/entities/sales/api/sales-productivity.api', () => ({
	listSalesTimelineV4: vi.fn()
}))
vi.mock('@/entities/sales/model/use-loss-reasons', () => ({
	useLossReasons: vi.fn()
}))
vi.mock('@/entities/sales/api/commerce.api', () => ({
	getPipelineNextActionTemplates: vi.fn(),
	listManagedPipelines: vi.fn(),
	createManagedPipeline: vi.fn(),
	renameManagedPipeline: vi.fn(),
	addManagedPipelineStage: vi.fn(),
	renameManagedPipelineStage: vi.fn(),
	reorderManagedPipelineStages: vi.fn(),
	getPipelineStageDurationSettings: vi.fn(),
	saveStageDurationLimit: vi.fn(),
	saveStageNextActionTemplate: vi.fn()
}))
vi.mock('@/features/crm-access-gate/api/crm-access.api', () => ({
	getPipelineTemplates: vi.fn()
}))
vi.mock('./DealCommercePanel', () => ({
	DealCommercePanel: () => null
}))
vi.mock('../model/use-sales-session', () => ({ useSalesSession: vi.fn() }))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn()
	})
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const membershipId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const lossReasonId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const date = '2026-09-05T10:00:00.000Z'
const contact: Customer = {
	kind: 'contacts',
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	name: 'Клиент для сделки',
	notes: null,
	phone: null,
	email: null,
	companyId: null,
	createdBySubject: 'actor',
	teamId: null,
	version: 1,
	archivedAt: null,
	createdAt: date,
	updatedAt: date
}
const pipeline: SalesPipeline = {
	id: '33333333-3333-4333-8333-333333333333',
	workspaceId,
	name: 'Продажи',
	templateKey: 'universal-sales',
	templateVersion: 1,
	stages: [
		{
			id: '44444444-4444-4444-8444-444444444444',
			key: 'new',
			name: 'Новая',
			position: 1,
			state: 'OPEN'
		},
		{
			id: '55555555-5555-4555-8555-555555555555',
			key: 'won',
			name: 'Успешно',
			position: 2,
			state: 'WON'
		},
		{
			id: '99999999-9999-4999-8999-999999999999',
			key: 'follow-up',
			name: 'Согласование',
			position: 3,
			state: 'OPEN'
		}
	]
}
const templateStageId = pipeline.stages[2].id
const deal: SalesDeal = {
	id: '66666666-6666-4666-8666-666666666666',
	workspaceId,
	version: 3,
	title: 'Заказ клиента',
	currency: 'RUB',
	amountMinor: 125050,
	pipelineId: pipeline.id,
	stageId: pipeline.stages[0].id,
	status: 'OPEN',
	contactId: contact.id,
	contactName: contact.name,
	assignedToSubject: 'actor',
	teamId: null,
	archivedAt: null,
	createdAt: date,
	updatedAt: date,
	nextTask: {
		id: '77777777-7777-4777-8777-777777777777',
		workspaceId,
		dealId: '66666666-6666-4666-8666-666666666666',
		version: 1,
		title: 'Позвонить клиенту',
		dueAt: date,
		status: 'OPEN',
		assignedToSubject: 'actor',
		completedAt: null,
		createdAt: date,
		updatedAt: date
	}
}
let client: QueryClient
let context: ReturnType<typeof useSalesSession>
beforeEach(() => {
	vi.clearAllMocks()
	useSessionStore.setState({
		status: 'authenticated',
		session: { accessToken: 'token', userId: 'actor' },
		sessionRevision: 1
	})
	vi.mocked(getCrmPermissions).mockResolvedValue({
		subject: 'actor',
		state: 'ACTIVE',
		permissions: ['sales:write']
	} as never)
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = true
			}
		},
		close: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = false
			}
		}
	})
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false }
		}
	})
	context = {
		workspace: {
			workspaceId,
			canWrite: true,
			membership: { membershipId }
		},
		session: { accessToken: 'token', userId: 'actor' },
		sessionRevision: 1,
		permissions: {
			data: {
				subject: 'actor',
				state: 'ACTIVE',
				permissions: ['sales:read', 'sales:write', 'customers:read'],
				role: 'CRM_USER'
			},
			isError: false,
			isPending: false,
			isFetching: false,
			refetch: vi.fn().mockResolvedValue({ isError: false })
		},
		canRead: true,
		canWrite: true,
		key: [workspaceId, 'actor', 1]
	} as unknown as ReturnType<typeof useSalesSession>
	vi.mocked(useSalesSession).mockImplementation(() => context)
	vi.mocked(listCustomers).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 20,
		total: 1,
		items: [contact]
	})
	vi.mocked(getCustomer).mockResolvedValue(contact)
	vi.mocked(getSalesDeal).mockResolvedValue(deal)
	vi.mocked(getSalesDealContext).mockResolvedValue({ deal, company: null })
	vi.mocked(useLossReasons).mockReturnValue({
		context: { canRead: true },
		query: {
			data: {
				schemaVersion: 1,
				workspaceId,
				version: 1,
				reasons: [
					{
						id: lossReasonId,
						title: 'Не подошли условия',
						archived: false
					}
				]
			},
			isError: false,
			isFetching: false,
			refetch: vi.fn().mockResolvedValue({ isError: false })
		},
		queryKey: ['sales', 'loss-reasons'],
		actorMembershipId: membershipId,
		actorReady: true,
		canManage: true
	} as never)
	vi.mocked(listSalesTimelineV4).mockResolvedValue({
		schemaVersion: 4,
		page: 1,
		pageSize: 10,
		total: 0,
		items: []
	} as never)
	vi.mocked(listSalesTimeline).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 10,
		total: 0,
		items: []
	})
	vi.mocked(listSalesTimelineV2).mockResolvedValue({
		schemaVersion: 2,
		page: 1,
		pageSize: 10,
		total: 0,
		items: []
	})
	vi.mocked(listSalesTimelineV3).mockResolvedValue({
		schemaVersion: 3,
		page: 1,
		pageSize: 10,
		total: 0,
		items: []
	})
	vi.mocked(listArchivedDealTasks).mockResolvedValue({
		schemaVersion: 1,
		page: 1,
		pageSize: 10,
		total: 0,
		items: []
	})
	vi.mocked(mutateSales).mockResolvedValue(deal)
	vi.mocked(getPipelineNextActionTemplates).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		pipelineId: pipeline.id,
		pipelineVersion: 1,
		items: [
			{ stageId: pipeline.stages[0].id, template: null },
			{
				stageId: pipeline.stages[2].id,
				template: { title: 'Позвонить после встречи', delayHours: 24 }
			}
		]
	} as never)
	vi.mocked(listManagedPipelines).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		items: []
	} as never)
	vi.mocked(getPipelineTemplates).mockResolvedValue({
		templates: []
	} as never)
})
afterEach(() => {
	cleanup()
	client.clear()
})
const mount = (children: ReactNode) =>
	render(
		<QueryClientProvider client={client}>
			<PendingCommandProvider owner={commandOwner('actor', 1)}>
				{children}
			</PendingCommandProvider>
		</QueryClientProvider>
	)

describe('Sales workflow forms', () => {
	it('adopts a duration-only pipeline version without losing dirty structural names', async () => {
		const managedPipeline = { ...pipeline, version: 5 }
		const initialSettings = {
			schemaVersion: 1 as const,
			workspaceId,
			pipelineId: pipeline.id,
			pipelineVersion: 5,
			items: pipeline.stages
				.filter(stage => stage.state === 'OPEN')
				.map(stage => ({ stageId: stage.id, limitDays: null }))
		}
		const refreshedPipeline = { ...managedPipeline, version: 6 }
		vi.mocked(listManagedPipelines)
			.mockResolvedValueOnce({
				schemaVersion: 1,
				workspaceId,
				items: [managedPipeline]
			} as never)
			.mockResolvedValue({
				schemaVersion: 1,
				workspaceId,
				items: [refreshedPipeline]
			} as never)
		vi.mocked(getPipelineStageDurationSettings).mockResolvedValue(
			initialSettings as never
		)
		vi.mocked(saveStageDurationLimit).mockResolvedValue({
			...initialSettings,
			pipelineVersion: 6,
			items: initialSettings.items.map(item =>
				item.stageId === pipeline.stages[0].id
					? { ...item, limitDays: 5 }
					: item
			)
		} as never)
		context.permissions.data!.permissions.push('sales:manage-pipelines')
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'actor',
			state: 'ACTIVE',
			role: 'OWNER',
			permissions: ['sales:read', 'sales:write', 'sales:manage-pipelines']
		} as never)

		mount(
			<PipelineManager
				context={context as never}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		const pipelineName = await screen.findByRole('textbox', {
			name: 'Название воронки'
		})
		const stageName = await screen.findByRole('textbox', {
			name: 'Название этапа «Новая»'
		})
		fireEvent.change(pipelineName, {
			target: { value: 'Мой черновик воронки' }
		})
		fireEvent.change(stageName, {
			target: { value: 'Мой черновик этапа' }
		})
		fireEvent.click(
			await screen.findByRole('checkbox', {
				name: 'Ограничить время на этапе «Новая»'
			})
		)
		fireEvent.change(
			await screen.findByRole('spinbutton', {
				name: 'Срок этапа «Новая», дней'
			}),
			{ target: { value: '5' } }
		)
		fireEvent.click(
			screen
				.getAllByRole('button', { name: 'Сохранить срок этапа' })
				.find(button => !button.hasAttribute('disabled'))!
		)
		await waitFor(() =>
			expect(saveStageDurationLimit).toHaveBeenCalledWith(
				context.session!.accessToken,
				workspaceId,
				pipeline.id,
				pipeline.stages[0].id,
				expect.objectContaining({ expectedVersion: 5, limitDays: 5 })
			)
		)
		await waitFor(() =>
			expect(listManagedPipelines).toHaveBeenCalledTimes(2)
		)
		expect(pipelineName).toHaveProperty('value', 'Мой черновик воронки')
		expect(stageName).toHaveProperty('value', 'Мой черновик этапа')
		expect(screen.queryByText(/Версия воронки изменилась/)).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Переименовать воронку' })
		).toHaveProperty('disabled', false)
		expect(
			stageName.closest('form')?.querySelector('button[type="submit"]')
		).toHaveProperty('disabled', false)

		fireEvent.submit(pipelineName.closest('form')!)
		await waitFor(() =>
			expect(renameManagedPipeline).toHaveBeenCalledOnce()
		)
		expect(renameManagedPipeline).toHaveBeenCalledWith(
			context.session!.accessToken,
			pipeline.id,
			expect.objectContaining({
				expectedVersion: 6,
				name: 'Мой черновик воронки'
			})
		)
	})

	it('keeps the structural version conflict when a pipeline structure actually changes', async () => {
		const managedPipeline = { ...pipeline, version: 5 }
		const changedPipeline = {
			...managedPipeline,
			version: 6,
			name: 'Серверная воронка',
			stages: managedPipeline.stages.map((stage, index) =>
				index === 0 ? { ...stage, name: 'Серверный этап' } : stage
			)
		}
		vi.mocked(listManagedPipelines)
			.mockResolvedValueOnce({
				schemaVersion: 1,
				workspaceId,
				items: [managedPipeline]
			} as never)
			.mockResolvedValue({
				schemaVersion: 1,
				workspaceId,
				items: [changedPipeline]
			} as never)
		vi.mocked(getPipelineStageDurationSettings).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			pipelineId: pipeline.id,
			pipelineVersion: 5,
			items: pipeline.stages
				.filter(stage => stage.state === 'OPEN')
				.map(stage => ({ stageId: stage.id, limitDays: null }))
		} as never)
		context.permissions.data!.permissions.push('sales:manage-pipelines')
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'actor',
			state: 'ACTIVE',
			role: 'OWNER',
			permissions: ['sales:read', 'sales:write', 'sales:manage-pipelines']
		} as never)

		mount(
			<PipelineManager
				context={context as never}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		const pipelineName = await screen.findByRole('textbox', {
			name: 'Название воронки'
		})
		const stageName = await screen.findByRole('textbox', {
			name: 'Название этапа «Новая»'
		})
		fireEvent.change(pipelineName, {
			target: { value: 'Мой черновик воронки' }
		})
		fireEvent.change(stageName, {
			target: { value: 'Мой черновик этапа' }
		})
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ['sales', 'managed-pipelines', ...context.key]
			})
		})
		await screen.findByText(/Версия воронки изменилась/)
		expect(pipelineName).toHaveProperty('value', 'Мой черновик воронки')
		expect(stageName).toHaveProperty('value', 'Мой черновик этапа')
		expect(
			screen.getByRole('button', { name: 'Переименовать воронку' })
		).toHaveProperty('disabled', true)
		expect(
			screen
				.getByDisplayValue('Мой черновик этапа')
				.closest('form')
				?.querySelector('button[type="submit"]')
		).toHaveProperty('disabled', true)
	})

	it('preserves a dirty stage-template editor draft when the server refetch changes its template', async () => {
		const managedPipeline = {
			...pipeline,
			version: 5,
			templateKey: 'universal-sales',
			templateVersion: 1
		}
		vi.mocked(listManagedPipelines).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			items: [managedPipeline]
		} as never)
		const templates = {
			schemaVersion: 1 as const,
			workspaceId,
			pipelineId: pipeline.id,
			pipelineVersion: 5,
			items: [
				{ stageId: pipeline.stages[0].id, template: null },
				{ stageId: templateStageId, template: null }
			]
		}
		vi.mocked(getPipelineNextActionTemplates).mockResolvedValue(
			templates as never
		)
		context.permissions.data!.permissions.push('sales:manage-pipelines')
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'actor',
			state: 'ACTIVE',
			role: 'OWNER',
			permissions: ['sales:read', 'sales:write', 'sales:manage-pipelines']
		} as never)
		mount(
			<PipelineManager
				context={context as never}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		const enable = await screen.findAllByRole('checkbox', {
			name: 'Предлагать следующее действие при переходе на этот этап'
		})
		await screen.findAllByText('Без шаблона')
		fireEvent.click(enable[0])
		const title = await screen.findByRole('textbox', {
			name: 'Название следующего действия'
		})
		fireEvent.change(title, { target: { value: 'Черновик звонка' } })
		const delay = screen.getByRole('spinbutton', {
			name: 'Срок через, часов'
		})
		fireEvent.change(delay, { target: { value: '36' } })

		vi.mocked(getPipelineNextActionTemplates).mockResolvedValue({
			...templates,
			pipelineVersion: 6,
			items: [
				{
					stageId: pipeline.stages[0].id,
					template: { title: 'Серверная новая версия', delayHours: 72 }
				},
				{
					stageId: templateStageId,
					template: null
				}
			]
		} as never)
		await act(async () => {
			await client.invalidateQueries({
				queryKey: [
					'sales',
					'next-action-templates',
					...context.key,
					pipeline.id
				]
			})
		})
		expect(title).toHaveProperty('value', 'Черновик звонка')
		expect(delay).toHaveProperty('value', '36')
		await waitFor(() =>
			expect(document.body.textContent).toContain('Серверная новая версия')
		)
		const applyDraft = await screen.findByRole('button', {
			name: 'Применить мой черновик к актуальной версии'
		})
		expect(screen.getByText(/Шаблон этапа изменился/)).toBeTruthy()
		const stageForm = title.closest('form')!
		const save = stageForm.querySelector<HTMLButtonElement>(
			'button[type="submit"]'
		)!
		expect(save).toHaveProperty('disabled', true)

		vi.mocked(saveStageNextActionTemplate).mockResolvedValue({
			...templates,
			pipelineVersion: 7,
			items: [
				{
					stageId: pipeline.stages[0].id,
					template: { title: 'Черновик звонка', delayHours: 36 }
				},
				{ stageId: templateStageId, template: null }
			]
		} as never)
		fireEvent.click(applyDraft)
		await waitFor(() => expect(save).toHaveProperty('disabled', false))
		fireEvent.submit(stageForm)
		await waitFor(() =>
			expect(saveStageNextActionTemplate).toHaveBeenCalledOnce()
		)
		expect(saveStageNextActionTemplate).toHaveBeenCalledWith(
			context.session!.accessToken,
			workspaceId,
			pipeline.id,
			pipeline.stages[0].id,
			expect.objectContaining({
				expectedVersion: 6,
				template: { title: 'Черновик звонка', delayHours: 36 }
			})
		)
	})

	it('keeps a dirty stage-template draft mounted when a background pipeline refresh fails', async () => {
		const managedPipeline = {
			...pipeline,
			version: 5,
			templateKey: 'universal-sales',
			templateVersion: 1
		}
		vi.mocked(listManagedPipelines).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			items: [managedPipeline]
		} as never)
		vi.mocked(getPipelineNextActionTemplates).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			pipelineId: pipeline.id,
			pipelineVersion: 5,
			items: [
				{ stageId: pipeline.stages[0].id, template: null },
				{ stageId: templateStageId, template: null }
			]
		} as never)
		context.permissions.data!.permissions.push('sales:manage-pipelines')
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'actor',
			state: 'ACTIVE',
			role: 'OWNER',
			permissions: ['sales:read', 'sales:write', 'sales:manage-pipelines']
		} as never)
		mount(
			<PipelineManager
				context={context as never}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		const enableTemplate = await screen.findAllByRole('checkbox', {
			name: 'Предлагать следующее действие при переходе на этот этап'
		})
		fireEvent.click(enableTemplate[0])
		const title = await screen.findByRole('textbox', {
			name: 'Название следующего действия'
		})
		fireEvent.change(title, { target: { value: 'Сохранить при ошибке' } })
		vi.mocked(listManagedPipelines).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Список временно недоступен')
		)
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ['sales', 'managed-pipelines', ...context.key]
			})
		})
		await screen.findByText(
			'Не удалось обновить воронки. Введённые изменения сохранены.'
		)
		expect(
			screen.getByRole('textbox', { name: 'Название следующего действия' })
		).toHaveProperty('value', 'Сохранить при ошибке')
	})

	it('can add an OPEN stage and save its template after pipeline and template refetch', async () => {
		const managedPipeline = {
			...pipeline,
			version: 5,
			templateKey: 'universal-sales',
			templateVersion: 1
		}
		const newStage = {
			id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			key: 'qualification',
			name: 'Квалификация',
			position: 3,
			state: 'OPEN' as const
		}
		const nextPipeline = {
			...managedPipeline,
			version: 6,
			stages: [...managedPipeline.stages, newStage]
		}
		const initialTemplates = {
			schemaVersion: 1 as const,
			workspaceId,
			pipelineId: pipeline.id,
			pipelineVersion: 5,
			items: [
				{ stageId: pipeline.stages[0].id, template: null },
				{ stageId: templateStageId, template: null }
			]
		}
		const refreshedTemplates = {
			...initialTemplates,
			pipelineVersion: 6,
			items: [
				...initialTemplates.items,
				{ stageId: newStage.id, template: null }
			]
		}
		vi.mocked(listManagedPipelines)
			.mockResolvedValueOnce({
				schemaVersion: 1,
				workspaceId,
				items: [managedPipeline]
			} as never)
			.mockResolvedValueOnce({
				schemaVersion: 1,
				workspaceId,
				items: [nextPipeline]
			} as never)
		vi.mocked(getPipelineNextActionTemplates)
			.mockResolvedValueOnce(initialTemplates as never)
			.mockResolvedValue(refreshedTemplates as never)
		vi.mocked(addManagedPipelineStage).mockResolvedValue({} as never)
		vi.mocked(saveStageNextActionTemplate).mockResolvedValue({
			...refreshedTemplates,
			pipelineVersion: 7,
			items: refreshedTemplates.items.map(item =>
				item.stageId === newStage.id
					? {
							...item,
							template: {
								title: 'Позвонить после квалификации',
								delayHours: 48
							}
						}
					: item
			)
		} as never)
		context.permissions.data!.permissions.push('sales:manage-pipelines')
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'actor',
			state: 'ACTIVE',
			role: 'OWNER',
			permissions: ['sales:read', 'sales:write', 'sales:manage-pipelines']
		} as never)
		mount(
			<PipelineManager
				context={context as never}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.change(
			await screen.findByRole('textbox', {
				name: 'Название нового этапа'
			}),
			{ target: { value: 'Квалификация' } }
		)
		const addStageButton = screen.getByRole('button', {
			name: 'Добавить этап'
		})
		await waitFor(() =>
			expect(addStageButton).toHaveProperty('disabled', false)
		)
		fireEvent.submit(addStageButton.closest('form')!)
		await waitFor(() =>
			expect(addManagedPipelineStage).toHaveBeenCalledOnce()
		)
		await waitFor(() =>
			expect(getPipelineNextActionTemplates).toHaveBeenCalledTimes(2)
		)
		expect(getPipelineNextActionTemplates).toHaveBeenLastCalledWith(
			context.session!.accessToken,
			workspaceId,
			pipeline.id
		)
		const enableTemplate = await screen.findAllByRole('checkbox', {
			name: 'Предлагать следующее действие при переходе на этот этап'
		})
		fireEvent.click(enableTemplate[2])
		fireEvent.change(
			await screen.findByRole('textbox', {
				name: 'Название следующего действия'
			}),
			{ target: { value: 'Позвонить после квалификации' } }
		)
		fireEvent.change(
			screen.getByRole('spinbutton', { name: 'Срок через, часов' }),
			{ target: { value: '48' } }
		)
		const saveTemplate = screen
			.getAllByRole('button', { name: 'Сохранить шаблон' })
			.find(button => !button.hasAttribute('disabled'))!
		fireEvent.click(saveTemplate)
		await waitFor(() =>
			expect(saveStageNextActionTemplate).toHaveBeenCalledWith(
				context.session!.accessToken,
				workspaceId,
				pipeline.id,
				newStage.id,
				expect.objectContaining({
					expectedVersion: 6,
					template: {
						title: 'Позвонить после квалификации',
						delayHours: 48
					}
				})
			)
		)
	})

	it('links a deal next task into the tasks screen in the same workspace', async () => {
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		const link = await screen.findByRole('link', {
			name: 'Открыть задачу'
		})
		expect(link.getAttribute('href')).toBe(
			`/tasks?task=${deal.nextTask!.id}&workspaceId=${workspaceId}`
		)
	})

	it('converts rubles without floating point or negative / overflowing amounts', () => {
		expect(parseRublesToMinor('1250,50')).toBe(125050)
		expect(parseRublesToMinor('0.01')).toBe(1)
		expect(parseRublesToMinor('0')).toBe(0)
		for (const value of ['-1', '1e3', '1.001', '21474836.48', 'NaN'])
			expect(parseRublesToMinor(value)).toBeNull()
	})
	it('creates a contact-linked deal and first action using server contact paging', async () => {
		const onClose = vi.fn()
		mount(
			<CreateDealDrawer
				pipelines={[pipeline]}
				onClose={onClose}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.click(
			await screen.findByRole('button', { name: contact.name })
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название сделки' }),
			{ target: { value: 'Новый заказ' } }
		)
		fireEvent.change(screen.getByRole('textbox', { name: 'Сумма, ₽' }), {
			target: { value: '1250,50' }
		})
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Первое действие' }),
			{ target: { value: 'Связаться' } }
		)
		fireEvent.change(screen.getByLabelText(/Срок действия/), {
			target: { value: '2026-09-07T12:30' }
		})
		fireEvent.submit(document.getElementById('create-sales-deal')!)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledTimes(1))
		expect(listCustomers).toHaveBeenCalledWith(
			'token',
			'contacts',
			workspaceId,
			1,
			10,
			''
		)
		expect(vi.mocked(mutateSales).mock.calls[0][1]).toMatchObject({
			workspaceId,
			mutation: {
				kind: 'create',
				title: 'Новый заказ',
				amountMinor: 125050,
				contactId: contact.id,
				pipelineId: pipeline.id,
				stageId: pipeline.stages[0].id,
				nextTask: {
					title: 'Связаться',
					dueAt: new Date('2026-09-07T12:30').toISOString()
				}
			}
		})
		expect(onClose).toHaveBeenCalledTimes(1)
	})
	it('recovers a failed contact refresh after selection without losing the selected contact or deal draft', async () => {
		mount(
			<CreateDealDrawer
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.click(
			await screen.findByRole('button', { name: contact.name })
		)
		fireEvent.change(screen.getByLabelText(/Название сделки/), {
			target: { value: 'Сохранённый черновик' }
		})
		vi.mocked(listCustomers).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Service unavailable')
		)
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ['crm-customers', workspaceId]
			})
		})
		await screen.findByText(
			'Не удалось обновить контакты. Выбранный клиент и поля сделки сохранены. Повторите проверку, чтобы создать сделку.'
		)
		expect(
			(
				screen.getByRole('button', {
					name: 'Создать сделку'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
		expect(screen.getByText(contact.name)).toBeTruthy()
		vi.mocked(listCustomers).mockResolvedValue({
			schemaVersion: 1,
			page: 1,
			pageSize: 10,
			total: 1,
			items: [contact]
		})
		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
		await waitFor(() =>
			expect(
				(
					screen.getByRole('button', {
						name: 'Создать сделку'
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		)
		expect(
			(screen.getByLabelText(/Название сделки/) as HTMLInputElement).value
		).toBe('Сохранённый черновик')
		expect(screen.getByText(contact.name)).toBeTruthy()
		expect(mutateSales).not.toHaveBeenCalled()
	})
	it('keeps the deal draft and selects the newly created contact without navigation', async () => {
		context.permissions.data!.permissions.push('customers:write')
		mount(
			<CreateDealDrawer
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		await screen.findByRole('button', { name: contact.name })
		fireEvent.change(screen.getByLabelText(/^Название сделки/), {
			target: { value: 'Не потерять черновик' }
		})
		fireEvent.change(screen.getByLabelText(/^Сумма, ₽/), {
			target: { value: '100,50' }
		})
		fireEvent.change(screen.getByLabelText(/^Срок действия/), {
			target: { value: '2026-09-20T14:30' }
		})
		fireEvent.change(screen.getByLabelText('Поиск контакта'), {
			target: { value: 'Новый клиент' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Создать контакт' })
		)
		expect(
			screen.getByRole('region', {
				name: 'Создание контакта внутри сделки'
			}).textContent
		).toContain('Новый клиент')
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить нового клиента' })
		)
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Создать сделку' })
			).toHaveProperty('disabled', false)
		)
		expect(screen.getByLabelText(/^Название сделки/)).toHaveProperty(
			'value',
			'Не потерять черновик'
		)
		expect(screen.getByLabelText(/^Сумма, ₽/)).toHaveProperty(
			'value',
			'100,50'
		)
		fireEvent.submit(document.getElementById('create-sales-deal')!)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toMatchObject(
			{
				kind: 'create',
				title: 'Не потерять черновик',
				amountMinor: 10050,
				contactId: '88888888-8888-4888-8888-888888888888'
			}
		)
	})
	it('does not label an open deal without a next action as closed', async () => {
		vi.mocked(getSalesDealContext).mockResolvedValue({
			deal: { ...deal, nextTask: null },
			company: null
		})
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(await screen.findByText('Нет следующего действия')).toBeTruthy()
		expect(screen.queryByText('Сделка закрыта')).toBeNull()
	})
	it('requires loss reason reselection after settings version changes', async () => {
		const lostStage = {
			id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
			key: 'lost',
			name: 'Потеряна',
			position: 4,
			state: 'LOST' as const
		}
		const pipelines = [
			{ ...pipeline, stages: [...pipeline.stages, lostStage] }
		]
		const tree = () => (
			<QueryClientProvider client={client}>
				<PendingCommandProvider owner={commandOwner('actor', 1)}>
					<DealDetailsDrawer
						id={deal.id}
						pipelines={pipelines}
						onClose={vi.fn()}
						onSaved={vi.fn()}
					/>
				</PendingCommandProvider>
			</QueryClientProvider>
		)
		const view = render(tree())
		fireEvent.change(
			await screen.findByRole('combobox', { name: 'Следующий этап' }),
			{
				target: { value: lostStage.id }
			}
		)
		fireEvent.change(
			await screen.findByRole('combobox', {
				name: 'Причина потери сделки'
			}),
			{
				target: { value: lossReasonId }
			}
		)

		const prior = vi.mocked(useLossReasons).mock.results.at(-1)?.value
		vi.mocked(useLossReasons).mockReturnValue({
			...prior,
			query: {
				...prior.query,
				data: { ...prior.query.data, version: 2 }
			}
		} as never)
		view.rerender(tree())
		expect((await screen.findByRole('alert')).textContent).toContain(
			'Справочник изменился'
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Что сделано / результат' }),
			{
				target: { value: 'Закрыли как потерянную' }
			}
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить результат' })
		)
		await waitFor(() => expect(mutateSales).not.toHaveBeenCalled())

		fireEvent.change(
			screen.getByRole('combobox', { name: 'Причина потери сделки' }),
			{
				target: { value: lossReasonId }
			}
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить результат' })
		)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toMatchObject(
			{
				kind: 'transition-v2',
				actorMembershipId: membershipId,
				lossReason: { id: lossReasonId, settingsVersion: 2 }
			}
		)
	})
	it('keeps interaction drafts mounted across the deal tabs', async () => {
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		const result = await screen.findByRole('combobox', {
			name: 'Итог звонка или встречи'
		})
		fireEvent.change(result, { target: { value: 'CALL_REACHED' } })
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Комментарий' }),
			{
				target: { value: 'Договорились связаться в пятницу' }
			}
		)
		fireEvent.click(screen.getByRole('tab', { name: 'КП и оплаты' }))
		fireEvent.click(screen.getByRole('tab', { name: 'История' }))
		fireEvent.click(screen.getByRole('tab', { name: 'Обзор' }))
		expect(result).toHaveProperty('value', 'CALL_REACHED')
		expect(
			screen.getByRole('textbox', { name: 'Комментарий' })
		).toHaveProperty('value', 'Договорились связаться в пятницу')
	})
	it('retries an unknown interaction with the exact same command and does not add a task implicitly', async () => {
		vi.mocked(mutateSales).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Ответ не подтверждён')
		)
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.change(
			await screen.findByRole('combobox', {
				name: 'Итог звонка или встречи'
			}),
			{ target: { value: 'CALL_REACHED' } }
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Комментарий' }),
			{
				target: { value: 'Ответил, ждёт предложение' }
			}
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить результат общения' })
		)
		await screen.findByRole('button', { name: 'Проверить сохранение' })
		const original = vi.mocked(mutateSales).mock.calls[0][1]
		expect(original.mutation).toEqual({
			kind: 'interaction',
			id: deal.id,
			expectedVersion: deal.version,
			result: 'CALL_REACHED',
			comment: 'Ответил, ждёт предложение'
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить сохранение' })
		)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateSales).mock.calls[1][1]).toBe(original)
		expect(vi.mocked(mutateSales).mock.calls[1][1].commandId).toBe(
			vi.mocked(mutateSales).mock.calls[0][1].commandId
		)
	})
	it('adopts a confirmed refreshed deal version only while the interaction form is clean', async () => {
		const queryKey = [
			'sales',
			'deal-context',
			...context.key,
			deal.id,
			'ACTIVE',
			'stage-duration'
		]
		const renderDrawer = () =>
			mount(
				<DealDetailsDrawer
					id={deal.id}
					pipelines={[pipeline]}
					onClose={vi.fn()}
					onSaved={vi.fn()}
				/>
			)
		const refreshed = { deal: { ...deal, version: 4 }, company: null }
		renderDrawer()
		await screen.findByRole('combobox', {
			name: 'Итог звонка или встречи'
		})
		await waitFor(() =>
			expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle')
		)
		act(() => client.setQueryData(queryKey, refreshed))
		await waitFor(() =>
			expect(client.getQueryData(queryKey)).toMatchObject({
				deal: { version: 4 }
			})
		)
		fireEvent.change(
			screen.getByRole('combobox', { name: 'Итог звонка или встречи' }),
			{ target: { value: 'MEETING_HELD' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить результат общения' })
		)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toMatchObject(
			{
				kind: 'interaction',
				expectedVersion: 4,
				result: 'MEETING_HELD'
			}
		)

		cleanup()
		client.clear()
		client = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false }
			}
		})
		vi.mocked(mutateSales).mockClear()
		renderDrawer()
		await screen.findByRole('combobox', {
			name: 'Итог звонка или встречи'
		})
		await waitFor(() =>
			expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle')
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Комментарий' }),
			{
				target: { value: 'Черновик основан на версии 3' }
			}
		)
		act(() => client.setQueryData(queryKey, refreshed))
		await waitFor(() =>
			expect(client.getQueryData(queryKey)).toMatchObject({
				deal: { version: 4 }
			})
		)
		fireEvent.change(
			screen.getByRole('combobox', { name: 'Итог звонка или встречи' }),
			{ target: { value: 'CALL_NO_ANSWER' } }
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить результат общения' })
		)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toMatchObject(
			{
				kind: 'interaction',
				expectedVersion: 3,
				result: 'CALL_NO_ANSWER',
				comment: 'Черновик основан на версии 3'
			}
		)
	})
	it('does not create without contacts permission', async () => {
		context.permissions.data!.permissions = ['sales:read', 'sales:write']
		mount(
			<CreateDealDrawer
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(
			await screen.findByText(
				'Нет доступа к контактам для создания сделки.'
			)
		).toBeTruthy()
		expect(listCustomers).not.toHaveBeenCalled()
		fireEvent.submit(document.getElementById('create-sales-deal')!)
		expect(mutateSales).not.toHaveBeenCalled()
	})
	it('preserves the opened version on background refresh and requires explicit conflict review', async () => {
		vi.mocked(mutateSales).mockRejectedValueOnce(
			new AuthenticatedApiError('conflict', 'Версия изменилась')
		)
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.change(
			await screen.findByRole('combobox', { name: 'Следующий этап' }),
			{ target: { value: pipeline.stages[1].id } }
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Что сделано / результат' }),
			{ target: { value: 'Договорились' } }
		)
		act(() =>
			client.setQueryData(['sales', 'deal', ...context.key, deal.id], {
				...deal,
				version: 4
			})
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сохранить результат' })
		)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toEqual({
			kind: 'transition-v2',
			actorMembershipId: membershipId,
			lossReason: null,
			id: deal.id,
			expectedVersion: 3,
			targetStageId: pipeline.stages[1].id,
			outcome: 'Договорились'
		})
		expect(await screen.findByText('Версия изменилась')).toBeTruthy()
	})
	it('applies the selected stage template, then protects manual title and due time across stage changes and template refetches', async () => {
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		const stageSelect = await screen.findByRole('combobox', {
			name: 'Следующий этап'
		})
		fireEvent.change(stageSelect, {
			target: { value: templateStageId }
		})
		const title = await screen.findByRole('textbox', {
			name: 'Следующее действие'
		})
		await waitFor(() =>
			expect(title).toHaveProperty('value', 'Позвонить после встречи')
		)
		const firstGeneratedDue = (
			screen.getByLabelText(/Срок следующего действия/) as HTMLInputElement
		).value
		expect(firstGeneratedDue).not.toBe('')

		vi.mocked(getPipelineNextActionTemplates).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			pipelineId: pipeline.id,
			pipelineVersion: 2,
			items: [
				{ stageId: pipeline.stages[0].id, template: null },
				{
					stageId: templateStageId,
					template: { title: 'Обновлённый шаблон', delayHours: 72 }
				}
			]
		} as never)
		await act(async () => {
			await client.invalidateQueries({
				queryKey: [
					'sales',
					'next-action-templates',
					...context.key,
					pipeline.id
				]
			})
		})
		fireEvent.change(stageSelect, {
			target: { value: pipeline.stages[0].id }
		})
		fireEvent.change(stageSelect, {
			target: { value: templateStageId }
		})
		await waitFor(() =>
			expect(title).toHaveProperty('value', 'Обновлённый шаблон')
		)

		fireEvent.change(title, { target: { value: 'Вручную согласовать' } })
		fireEvent.change(screen.getByLabelText(/Срок следующего действия/), {
			target: { value: '2026-10-20T15:45' }
		})
		fireEvent.change(stageSelect, {
			target: { value: pipeline.stages[0].id }
		})
		fireEvent.change(stageSelect, {
			target: { value: templateStageId }
		})
		expect(title).toHaveProperty('value', 'Вручную согласовать')
		expect(
			screen.getByLabelText(/Срок следующего действия/)
		).toHaveProperty('value', '2026-10-20T15:45')
		fireEvent.change(screen.getByLabelText(/Что сделано \/ результат/), {
			target: { value: 'Согласовали переход' }
		})
		fireEvent.submit(document.getElementById('deal-result-form')!)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toMatchObject(
			{
				kind: 'transition-v2',
				actorMembershipId: membershipId,
				lossReason: null,
				targetStageId: templateStageId,
				nextTask: {
					title: 'Вручную согласовать',
					dueAt: new Date('2026-10-20T15:45').toISOString()
				}
			}
		)
	})
	it('does not let a late template response overwrite a manual draft and keeps manual entry available after a fetch error', async () => {
		let resolveTemplates!: (value: unknown) => void
		vi.mocked(getPipelineNextActionTemplates).mockReturnValueOnce(
			new Promise(resolve => {
				resolveTemplates = resolve
			}) as never
		)
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		const stageSelect = await screen.findByRole('combobox', {
			name: 'Следующий этап'
		})
		await waitFor(() =>
			expect(getPipelineNextActionTemplates).toHaveBeenCalled()
		)
		fireEvent.change(stageSelect, {
			target: { value: templateStageId }
		})
		const title = screen.getByRole('textbox', {
			name: 'Следующее действие'
		})
		fireEvent.change(title, { target: { value: 'Мой ручной текст' } })
		fireEvent.change(screen.getByLabelText(/Срок следующего действия/), {
			target: { value: '2026-10-21T09:10' }
		})
		await act(async () => {
			resolveTemplates({
				schemaVersion: 1,
				workspaceId,
				pipelineId: pipeline.id,
				pipelineVersion: 1,
				items: [
					{ stageId: pipeline.stages[0].id, template: null },
					{
						stageId: templateStageId,
						template: { title: 'Поздний шаблон', delayHours: 48 }
					}
				]
			})
		})
		expect(title).toHaveProperty('value', 'Мой ручной текст')
		expect(
			screen.getByLabelText(/Срок следующего действия/)
		).toHaveProperty('value', '2026-10-21T09:10')

		cleanup()
		client.clear()
		client = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false }
			}
		})
		vi.mocked(mutateSales).mockClear()
		vi.mocked(getPipelineNextActionTemplates).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Шаблоны недоступны')
		)
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		fireEvent.change(
			await screen.findByRole('combobox', { name: 'Следующий этап' }),
			{ target: { value: templateStageId } }
		)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Следующее действие' }),
			{
				target: { value: 'Ручное действие без шаблона' }
			}
		)
		fireEvent.change(screen.getByLabelText(/Срок следующего действия/), {
			target: { value: '2026-10-22T11:30' }
		})
		fireEvent.change(screen.getByLabelText(/Что сделано \/ результат/), {
			target: { value: 'Продолжить вручную' }
		})
		fireEvent.submit(document.getElementById('deal-result-form')!)
		await waitFor(() => expect(mutateSales).toHaveBeenCalledOnce())
		expect(vi.mocked(mutateSales).mock.calls[0][1].mutation).toMatchObject(
			{
				nextTask: {
					title: 'Ручное действие без шаблона',
					dueAt: new Date('2026-10-22T11:30').toISOString()
				}
			}
		)
	})
	it('keeps a template delay as elapsed hours across a daylight-saving transition', async () => {
		const previousTz = process.env.TZ
		process.env.TZ = 'America/New_York'
		const now = Date.parse('2026-03-08T06:30:00.000Z')
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
		try {
			mount(
				<DealDetailsDrawer
					id={deal.id}
					pipelines={[pipeline]}
					onClose={vi.fn()}
					onSaved={vi.fn()}
				/>
			)
			fireEvent.change(
				await screen.findByRole('combobox', { name: 'Следующий этап' }),
				{ target: { value: templateStageId } }
			)
			await waitFor(() =>
				expect(
					screen.getByRole('textbox', { name: 'Следующее действие' })
				).toHaveProperty('value', 'Позвонить после встречи')
			)
			const expectedDue = new Date(now + 24 * 60 * 60 * 1000).toISOString()
			fireEvent.change(screen.getByLabelText(/Что сделано \/ результат/), {
				target: { value: 'DST transition' }
			})
			fireEvent.submit(document.getElementById('deal-result-form')!)
			await waitFor(() => expect(mutateSales).toHaveBeenCalledOnce())
			expect(
				vi.mocked(mutateSales).mock.calls[0][1].mutation
			).toMatchObject({
				nextTask: { dueAt: expectedDue }
			})
		} finally {
			nowSpy.mockRestore()
			if (previousTz === undefined) delete process.env.TZ
			else process.env.TZ = previousTz
		}
	})
	it('keeps read-only deal data visible but disables mutation fieldsets', async () => {
		context.canWrite = false
		context.workspace.canWrite = false
		mount(
			<DealDetailsDrawer
				id={deal.id}
				pipelines={[pipeline]}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(await screen.findByText(contact.name)).toBeTruthy()
		expect(
			screen
				.getByRole('combobox', { name: 'Следующий этап' })
				.closest('fieldset')
		).toHaveProperty('disabled', true)
		fireEvent.click(
			screen.getByRole('button', { name: 'Архивировать сделку' })
		)
		expect(mutateSales).not.toHaveBeenCalled()
	})
	it('hides a previously selected task when fresh read authorization fails', () => {
		context.canRead = false
		context.canWrite = false
		mount(
			<CompleteTaskDrawer
				task={deal.nextTask!}
				onClose={vi.fn()}
				onSaved={vi.fn()}
			/>
		)
		expect(screen.queryByText(/Позвонить клиенту/)).toBeNull()
		expect(getSalesDeal).not.toHaveBeenCalled()
	})
})
