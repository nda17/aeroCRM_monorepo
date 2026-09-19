import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import {
	useCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import {
	getCrmCommercialPolicy,
	type CrmCommercialPolicy
} from '@/entities/crm-commercial-policy'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { CrmCommercialPolicyCard } from './CrmCommercialPolicyCard'

vi.mock('@/entities/crm-access', async original => ({
	...(await original<typeof import('@/entities/crm-access')>()),
	useCrmWorkspaceAccess: () => ({ workspaceId: target }),
	useCrmPermissions: vi.fn()
}))
vi.mock('@/entities/crm-commercial-policy', async original => ({
	...(await original<typeof import('@/entities/crm-commercial-policy')>()),
	getCrmCommercialPolicy: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: { success: vi.fn(), error: vi.fn() }
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
let target: string
let permissions: CrmPermissions
let ready: boolean
let client: QueryClient
const policy: CrmCommercialPolicy = {
	schemaVersion: 1,
	productCode: 'WINCRM',
	version: 3,
	currency: 'RUB',
	monthlyPriceMinor: 129_901,
	yearlyPriceMinor: 1_234_599,
	additionalSeatMonthlyPriceMinor: 25_007,
	additionalSeatYearlyPriceMinor: 250_005,
	includedSeats: 2,
	trialSeatLimit: 5,
	trialDays: 5,
	graceDays: 3,
	createdAt: '2026-09-05T12:00:00.000Z'
}
const view = (visible = true) => (
	<QueryClientProvider client={client}>
		<p>Команда остаётся доступной</p>
		{visible ? <CrmCommercialPolicyCard /> : null}
	</QueryClientProvider>
)
const price = () => screen.queryByText('Месячная стоимость')
beforeEach(() => {
	vi.resetAllMocks()
	target = workspaceId
	ready = true
	Object.defineProperty(navigator, 'onLine', {
		configurable: true,
		value: true
	})
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	useSessionStore.setState({
		status: 'authenticated',
		session: { userId: 'owner', accessToken: 'synthetic-token' },
		sessionRevision: 1
	})
	permissions = {
		schemaVersion: 1,
		workspaceId,
		subject: 'owner',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [],
		permissions: []
	}
	vi.mocked(useCrmPermissions).mockImplementation(() => {
		client.setQueryData(['crm-permissions', workspaceId, 'owner', 1], {
			...permissions
		})
		return {
			data: permissions,
			isSuccess: ready,
			isFetching: !ready
		} as never
	})
	vi.mocked(getCrmCommercialPolicy).mockResolvedValue(policy)
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
})
describe('published commercial policy card', () => {
	it.each(['OWNER', 'CRM_ADMIN'] as const)(
		'shows %s the separate period prices without needing team permissions',
		async role => {
			permissions.role = role
			render(view())
			await screen.findByText('Месячная стоимость')
			const card = screen.getByRole('region', {
				name: 'Опубликованные условия WinCRM'
			})
			const text = card.textContent!.replace(/\s+/g, ' ')
			for (const amount of [
				'1 299,01 ₽',
				'12 345,99 ₽',
				'250,07 ₽',
				'2 500,05 ₽'
			])
				expect(text).toContain(amount)
			expect(text).toContain(
				'В стоимость включено мест: 2, вместе с владельцем'
			)
			expect(text).toContain(
				'Бесплатный период — 5 дней, мест на Trial: 5'
			)
			expect(text).toContain('не условия вашей действующей подписки')
			expect(within(card).getAllByRole('button')).toHaveLength(1)
			expect(getCrmCommercialPolicy).toHaveBeenCalledExactlyOnceWith(
				'synthetic-token'
			)
		}
	)
	it('allows READ_ONLY without displaying a payment or Trial activation action', async () => {
		permissions.state = 'READ_ONLY'
		render(view())
		await screen.findByText('Месячная стоимость')
		expect(
			screen.getAllByRole('button').map(button => button.textContent)
		).toEqual(['Обновить условия'])
	})
	it.each(['TEAM_LEAD', 'MANAGER', 'ANALYST'] as const)(
		'does not request the policy for %s or block other settings',
		role => {
			permissions.role = role
			render(view())
			expect(screen.getByText('Команда остаётся доступной')).toBeTruthy()
			expect(getCrmCommercialPolicy).not.toHaveBeenCalled()
		}
	)
	it.each([
		'unconfirmed',
		'foreign subject',
		'foreign workspace',
		'anonymous'
	] as const)(
		'rejects %s context before requesting Billing',
		condition => {
			if (condition === 'unconfirmed') ready = false
			else if (condition === 'foreign subject')
				permissions.subject = 'foreign'
			else if (condition === 'foreign workspace')
				permissions.workspaceId = '22222222-2222-4222-8222-222222222222'
			else useSessionStore.getState().setAnonymous()
			render(view())
			expect(getCrmCommercialPolicy).not.toHaveBeenCalled()
			expect(price()).toBeNull()
		}
	)
	it('keeps the rest of Settings usable on 401 and permits an explicit safe retry without logout', async () => {
		vi.mocked(getCrmCommercialPolicy).mockRejectedValueOnce(
			new AuthenticatedApiError(
				'unauthorized',
				'Sensitive provider detail'
			)
		)
		render(view())
		await screen.findByText('Условия пока недоступны')
		expect(screen.getByText('Команда остаётся доступной')).toBeTruthy()
		expect(screen.queryByText('Sensitive provider detail')).toBeNull()
		expect(useSessionStore.getState().status).toBe('authenticated')
		expect(toast.error).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить загрузку условий' })
		)
		await screen.findByText('Месячная стоимость')
		expect(toast.success).toHaveBeenCalledWith('Условия WinCRM обновлены')
	})
	it('hides formerly loaded prices on refresh failure rather than inventing or presenting stale current conditions', async () => {
		render(view())
		await screen.findByText('Месячная стоимость')
		vi.mocked(getCrmCommercialPolicy).mockRejectedValueOnce(
			new Error('Unavailable')
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Обновить условия' })
		)
		await screen.findByText('Условия пока недоступны')
		expect(price()).toBeNull()
		expect(toast.error).toHaveBeenCalledWith(
			'Не удалось обновить условия WinCRM'
		)
	})
	it('does not start manual retry while offline', async () => {
		render(view())
		await screen.findByText('Месячная стоимость')
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			value: false
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Обновить условия' })
		)
		expect(getCrmCommercialPolicy).toHaveBeenCalledTimes(1)
	})
	it.each([
		'unmount',
		'workspace',
		'session',
		'permissions',
		'role'
	] as const)(
		'discards delayed refresh after %s without cache or toast effects',
		async boundary => {
			const rendered = render(view())
			await screen.findByText('Месячная стоимость')
			let resolve!: (value: CrmCommercialPolicy) => void
			vi.mocked(getCrmCommercialPolicy).mockImplementationOnce(
				() =>
					new Promise(finish => {
						resolve = finish
					})
			)
			fireEvent.click(
				screen.getByRole('button', { name: 'Обновить условия' })
			)
			await waitFor(() =>
				expect(getCrmCommercialPolicy).toHaveBeenCalledTimes(2)
			)
			if (boundary === 'unmount') rendered.rerender(view(false))
			else if (boundary === 'workspace') {
				target = '22222222-2222-4222-8222-222222222222'
				rendered.rerender(view())
			} else if (boundary === 'session')
				act(() =>
					useSessionStore.getState().setAuthenticated({
						userId: 'other',
						accessToken: 'other-token'
					})
				)
			else {
				if (boundary === 'permissions') ready = false
				else permissions.role = 'MANAGER'
				rendered.rerender(view())
			}
			await act(async () => resolve({ ...policy, version: 99 }))
			expect(price()).toBeNull()
			expect(toast.success).not.toHaveBeenCalled()
			expect(toast.error).not.toHaveBeenCalled()
			expect(
				client
					.getQueryCache()
					.findAll()
					.some(
						query =>
							(query.state.data as CrmCommercialPolicy | undefined)
								?.version === 99
					)
			).toBe(false)
		}
	)
	it('isolates the policy query by subject, revision and workspace without caching its bearer token', async () => {
		render(view())
		await screen.findByText('Месячная стоимость')
		const queries = client
			.getQueryCache()
			.findAll({ queryKey: ['crm-commercial-policy'] })
		expect(queries[0].queryKey.slice(0, 4)).toEqual([
			'crm-commercial-policy',
			workspaceId,
			'owner',
			1
		])
		expect(
			JSON.stringify(
				queries.map(query => [query.queryKey, query.state.data])
			)
		).not.toContain('synthetic-token')
	})
	it('checks a narrowed permission cache before React has rendered the new role', async () => {
		render(view())
		await screen.findByText('Месячная стоимость')
		let resolve!: (value: CrmCommercialPolicy) => void
		vi.mocked(getCrmCommercialPolicy).mockImplementationOnce(
			() =>
				new Promise(finish => {
					resolve = finish
				})
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Обновить условия' })
		)
		await waitFor(() =>
			expect(getCrmCommercialPolicy).toHaveBeenCalledTimes(2)
		)
		await act(async () => {
			client.setQueryData(['crm-permissions', workspaceId, 'owner', 1], {
				...permissions,
				role: 'MANAGER',
				dataScope: 'OWN'
			})
			resolve({ ...policy, version: 99 })
		})
		expect(toast.success).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
		expect(
			client
				.getQueryCache()
				.findAll()
				.some(
					query =>
						(query.state.data as CrmCommercialPolicy | undefined)
							?.version === 99
				)
		).toBe(false)
	})
})
