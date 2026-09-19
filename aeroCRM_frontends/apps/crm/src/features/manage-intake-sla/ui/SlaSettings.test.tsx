import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSlaRule, type SlaRuleResponse } from '@/entities/intake-sla'
import { useAssigneeOptions } from '@/entities/crm-team'
import { getCrmPermissions } from '@/entities/crm-access'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useMemoryCommand } from '@/shared/lib/pending-command'
import type { SlaContext } from '../model/use-sla-session'
import { SlaSettingsBody } from './SlaSettings'

const command = vi.hoisted(() => ({
	locked: false,
	uncertain: false,
	running: false,
	error: null as AuthenticatedApiError | null,
	execute: vi.fn(),
	reset: vi.fn()
}))
vi.mock('@/shared/lib/pending-command', async original => ({
	...(await original<object>()),
	useMemoryCommand: vi.fn()
}))
vi.mock('@/entities/intake-sla', async original => ({
	...(await original<object>()),
	getSlaRule: vi.fn()
}))
vi.mock('@/entities/crm-team', async original => ({
	...(await original<object>()),
	useAssigneeOptions: vi.fn()
}))
vi.mock('@/entities/crm-access', async original => ({
	...(await original<object>()),
	getCrmPermissions: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
let client: QueryClient
let context: SlaContext
let response: SlaRuleResponse
const view = () => (
	<QueryClientProvider client={client}>
		<SlaSettingsBody context={context} />
	</QueryClientProvider>
)
beforeEach(() => {
	vi.clearAllMocks()
	Object.assign(command, {
		locked: false,
		uncertain: false,
		running: false,
		error: null
	})
	vi.mocked(useMemoryCommand).mockReturnValue(command as never)
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	context = {
		workspace: { workspaceId, canWrite: true },
		session: { userId: 'owner', accessToken: 'token' },
		sessionRevision: 1,
		key: 'owner',
		scopeKey: 'owner',
		current: () => true,
		canRead: true,
		canWrite: true,
		directory: { canRead: true }
	} as unknown as SlaContext
	response = {
		schemaVersion: 1,
		workspaceId,
		rule: null,
		deliveryEnabled: false
	}
	vi.mocked(getSlaRule).mockImplementation(async () => response)
	vi.mocked(useAssigneeOptions).mockReturnValue({
		scopeKey: 'owner',
		search: '',
		page: 1,
		pageSize: 20,
		enabled: true,
		loading: false,
		error: false,
		data: { items: [], selected: null, total: 0 },
		resolveBinding: () => null,
		isCurrent: () => true,
		refetch: vi.fn(),
		setPage: vi.fn(),
		setSearch: vi.fn()
	} as never)
})
afterEach(() => {
	cleanup()
	client.clear()
})
describe('SLA settings', () => {
	it('shows inactive delivery while allowing preparation without opting in', async () => {
		render(view())
		await screen.findByText('SLA не активирован')
		expect(
			screen.getByRole('checkbox', { name: 'Включить правило SLA' })
		).toHaveProperty('checked', false)
		expect(
			screen.getByText(/Доставка SLA-напоминаний ещё не активирована/)
		).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Сохранить SLA' }))
		expect(command.execute).toHaveBeenCalledOnce()
		const built = command.execute.mock.calls[0][0]()
		expect(built).toMatchObject({
			schemaVersion: 1,
			workspaceId,
			expectedVersion: 0,
			config: { enabled: false, channels: ['EMAIL'] }
		})
	})
	it.each(['notFound', 'temporary'] as const)(
		'does not show a working form when endpoint is %s',
		async kind => {
			vi.mocked(getSlaRule).mockRejectedValue(
				new AuthenticatedApiError(kind, 'unavailable')
			)
			render(view())
			await screen.findByText(
				kind === 'notFound' ? 'SLA пока не активирован' : 'SLA недоступен'
			)
			expect(
				screen.queryByRole('button', { name: 'Сохранить SLA' })
			).toBeNull()
			expect(command.execute).not.toHaveBeenCalled()
		}
	)
	it('keeps read-only settings visible and all editing disabled', async () => {
		context = { ...context, canWrite: false }
		render(view())
		await screen.findByText('SLA не активирован')
		expect(
			screen.getByRole('button', { name: 'Сохранить SLA' })
		).toHaveProperty('disabled', true)
		expect(
			screen.getByRole('checkbox', { name: 'Включить правило SLA' })
		).toHaveProperty('disabled', true)
	})
	it('does not load or leak prior settings after role access is removed', async () => {
		const mounted = render(view())
		await screen.findByText('SLA не активирован')
		context = {
			...context,
			canRead: false,
			canWrite: false,
			key: 'manager'
		}
		mounted.rerender(view())
		expect(screen.queryByText('SLA входящих обращений')).toBeNull()
		expect(getSlaRule).toHaveBeenCalledOnce()
	})
	it('requires explicit notification recipients and channels before enabling', async () => {
		render(view())
		await screen.findByText('SLA не активирован')
		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Включить правило SLA' })
		)
		fireEvent.click(screen.getByRole('checkbox', { name: 'Email' }))
		fireEvent.click(screen.getByRole('button', { name: 'Сохранить SLA' }))
		expect(command.execute).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Уведомлять руководителей' })
		)
		fireEvent.click(screen.getByRole('checkbox', { name: 'Email' }))
		fireEvent.click(screen.getByRole('button', { name: 'Сохранить SLA' }))
		expect(command.execute.mock.calls[0][0]()).toMatchObject({
			config: {
				enabled: true,
				notifyManagers: true,
				channels: ['EMAIL'],
				responsibleBinding: null
			}
		})
	})
	it('retries the existing uncertain command without constructing a new id', async () => {
		Object.assign(command, { locked: true, uncertain: true })
		render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Повторить ту же команду SLA'
			})
		)
		expect(command.execute).toHaveBeenCalledWith()
		expect(
			screen.getByRole('button', { name: 'Сохранить SLA' })
		).toHaveProperty('disabled', true)
	})
	it('uses directory display names and normalizes only a verified owner to a null binding', async () => {
		const owner = {
			subject: 'owner',
			membershipId: '22222222-2222-4222-8222-222222222222',
			role: 'OWNER',
			displayName: 'Дмитрий',
			verifiedEmail: null
		}
		vi.mocked(useAssigneeOptions).mockReturnValue({
			scopeKey: 'owner',
			search: '',
			page: 1,
			pageSize: 20,
			enabled: true,
			loading: false,
			error: false,
			selected: owner,
			data: { items: [owner], selected: owner, total: 1 },
			resolveBinding: (binding: {
				subject: string
				membershipId?: string | null
			}) =>
				binding.subject === owner.subject &&
				binding.membershipId === owner.membershipId
					? owner
					: null,
			isCurrent: () => true,
			refetch: vi.fn(),
			setPage: vi.fn(),
			setSearch: vi.fn()
		} as never)
		render(view())
		await screen.findByText('SLA не активирован')
		fireEvent.change(
			screen.getByRole('combobox', { name: 'Ответственный за SLA' }),
			{ target: { value: owner.membershipId } }
		)
		fireEvent.click(screen.getByRole('button', { name: 'Сохранить SLA' }))
		expect(command.execute.mock.calls[0][0]()).toMatchObject({
			config: {
				responsibleBinding: { subject: 'owner', membershipId: null }
			}
		})
		expect(screen.queryByRole('textbox', { name: /subject/i })).toBeNull()
	})
	it('refuses a command when fresh backend permissions narrow the role', async () => {
		render(view())
		await screen.findByText('SLA не активирован')
		vi.mocked(getCrmPermissions).mockResolvedValue({
			workspaceId,
			subject: 'owner',
			role: 'MANAGER',
			state: 'ACTIVE',
			dataScope: 'OWN',
			teamIds: [],
			permissions: ['intake:read', 'intake:write']
		} as never)
		const authorize = vi.mocked(useMemoryCommand).mock.calls.at(-1)![3]
		await expect(authorize()).rejects.toThrow('Права изменились')
	})
	it('drops a delayed response if the session is no longer current', async () => {
		let resolve!: (value: SlaRuleResponse) => void
		let current = true
		context.current = () => current
		vi.mocked(getSlaRule).mockImplementation(
			() =>
				new Promise(done => {
					resolve = done
				})
		)
		render(view())
		await waitFor(() => expect(getSlaRule).toHaveBeenCalledOnce())
		current = false
		resolve(response)
		await screen.findByText('SLA недоступен')
		expect(
			screen.queryByRole('button', { name: 'Сохранить SLA' })
		).toBeNull()
	})
})
