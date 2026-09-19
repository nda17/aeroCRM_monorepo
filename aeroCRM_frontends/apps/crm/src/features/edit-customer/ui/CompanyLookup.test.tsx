import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	crmPermissionScope,
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import {
	lookupCompany,
	type CompanyLookupResult
} from '@/entities/customer'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import toast from 'react-hot-toast'
import { CompanyLookup } from './CompanyLookup'

vi.mock('@/entities/customer', async importOriginal => ({
	...(await importOriginal<typeof import('@/entities/customer')>()),
	lookupCompany: vi.fn()
}))
vi.mock('@/entities/crm-access', async importOriginal => ({
	...(await importOriginal<typeof import('@/entities/crm-access')>()),
	getCrmPermissions: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const permissions: CrmPermissions = {
	schemaVersion: 1,
	workspaceId,
	subject: 'user-1',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['customers:write']
}
const response: CompanyLookupResult = {
	schemaVersion: 1,
	provider: 'DADATA',
	queriedAt: '2026-09-07T12:00:00.000Z',
	inn: '7707083893',
	items: [
		{
			name: 'Найденная компания',
			legalName: 'Полное название',
			inn: '7707083893',
			kpp: '770701001',
			ogrn: '1027700132195',
			legalAddress: 'Москва',
			entityType: 'LEGAL',
			status: 'ACTIVE'
		}
	]
}
const deferred = <T,>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>(done => {
		resolve = done
	})
	return { promise, resolve }
}
const props = () => ({
	workspaceId,
	scopeKey: crmPermissionScope(permissions),
	inn: response.inn,
	canWrite: true,
	hasExisting: false,
	hasKpp: false,
	onApply: vi.fn(() => true)
})
beforeEach(() => {
	vi.resetAllMocks()
	useSessionStore.setState({
		session: { accessToken: 'token', userId: 'user-1' },
		status: 'authenticated',
		sessionRevision: 1
	})
	vi.mocked(getCrmPermissions).mockResolvedValue(permissions)
	vi.mocked(lookupCompany).mockResolvedValue(response)
})
afterEach(cleanup)
const search = async () => {
	fireEvent.click(screen.getByRole('button', { name: 'Найти реквизиты' }))
	await screen.findByText('Найденная компания')
}

describe('CompanyLookup authority-bound explicit actions', () => {
	it('does not launch the lookup after a stale preflight permissions response', async () => {
		const view = props(),
			tree = render(<CompanyLookup {...view} />),
			pending = deferred<CrmPermissions>()
		vi.mocked(getCrmPermissions).mockReturnValue(pending.promise)
		fireEvent.click(
			screen.getByRole('button', { name: 'Найти реквизиты' })
		)
		tree.rerender(<CompanyLookup {...view} inn="500100732259" />)
		await act(async () => pending.resolve(permissions))
		expect(lookupCompany).not.toHaveBeenCalled()
		expect(view.onApply).not.toHaveBeenCalled()
	})
	it.each(['DADATA', 'OTHER_PROVIDER'])(
		'shows the lookup timestamp without provider attribution for %s',
		async provider => {
			vi.mocked(lookupCompany).mockResolvedValue({ ...response, provider })
			render(<CompanyLookup {...props()} />)
			await search()
			const hint = screen.getByText(/Реквизиты получены/).textContent
			expect(hint).toContain(
				new Date(response.queriedAt).toLocaleString('ru-RU')
			)
			expect(hint).toContain('Сайт и заметки не изменяются.')
			expect(document.body.textContent).not.toMatch(
				/Источник|DaData|DADATA|OTHER_PROVIDER/
			)
		}
	)
	it('does not query on render or keystrokes; fresh permission is required for lookup and application', async () => {
		const view = props(),
			tree = render(<CompanyLookup {...view} />)
		tree.rerender(<CompanyLookup {...view} inn="770708389" />)
		tree.rerender(<CompanyLookup {...view} />)
		expect(getCrmPermissions).not.toHaveBeenCalled()
		expect(lookupCompany).not.toHaveBeenCalled()
		await search()
		expect(lookupCompany).toHaveBeenCalledExactlyOnceWith(
			'token',
			workspaceId,
			response.inn
		)
		expect(view.onApply).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Заполнить форму' })
		)
		await waitFor(() =>
			expect(view.onApply).toHaveBeenCalledExactlyOnceWith(
				response.items[0],
				false
			)
		)
		expect(getCrmPermissions).toHaveBeenCalledTimes(2)
	})
	it('blocks invalid checksum and duplicate clicks before launching any second request', async () => {
		const view = props(),
			tree = render(<CompanyLookup {...view} inn="1234567890" />)
		fireEvent.click(
			screen.getByRole('button', { name: 'Найти реквизиты' })
		)
		expect(lookupCompany).not.toHaveBeenCalled()
		expect((await screen.findByRole('alert')).textContent).toContain(
			'контрольной суммой'
		)
		tree.rerender(<CompanyLookup {...view} />)
		const pending = deferred<CompanyLookupResult>()
		vi.mocked(lookupCompany).mockReturnValue(pending.promise)
		const button = screen.getByRole('button', { name: 'Найти реквизиты' })
		fireEvent.click(button)
		fireEvent.click(button)
		await waitFor(() => expect(lookupCompany).toHaveBeenCalledTimes(1))
		await act(async () => pending.resolve(response))
	})
	it.each([
		{ state: 'READ_ONLY' },
		{ subject: 'another-user' },
		{ workspaceId: '22222222-2222-4222-8222-222222222222' },
		{ permissions: [] },
		{ dataScope: 'OWN' }
	])(
		'fails closed before lookup when fresh authority changes: %j',
		async patch => {
			vi.mocked(getCrmPermissions).mockResolvedValue({
				...permissions,
				...patch
			} as CrmPermissions)
			render(<CompanyLookup {...props()} />)
			fireEvent.click(
				screen.getByRole('button', { name: 'Найти реквизиты' })
			)
			await screen.findByRole('alert')
			expect(lookupCompany).not.toHaveBeenCalled()
		}
	)
	it('rechecks revoked authority before apply and discards the result without applying it', async () => {
		const view = props()
		render(<CompanyLookup {...view} />)
		await search()
		vi.mocked(getCrmPermissions).mockResolvedValue({
			...permissions,
			state: 'READ_ONLY'
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Заполнить форму' })
		)
		await screen.findByRole('alert')
		expect(view.onApply).not.toHaveBeenCalled()
		expect(screen.queryByText('Найденная компания')).toBeNull()
	})
	it.each([
		'inn',
		'inn-away-back',
		'workspace',
		'scope',
		'write',
		'token',
		'subject',
		'revision',
		'unmount'
	])('discards a late response after %s changes', async scenario => {
		const view = props(),
			tree = render(<CompanyLookup {...view} />),
			pending = deferred<CompanyLookupResult>()
		vi.mocked(lookupCompany).mockReturnValue(pending.promise)
		fireEvent.click(
			screen.getByRole('button', { name: 'Найти реквизиты' })
		)
		await waitFor(() => expect(lookupCompany).toHaveBeenCalledTimes(1))
		if (scenario === 'inn' || scenario === 'inn-away-back') {
			tree.rerender(<CompanyLookup {...view} inn="500100732259" />)
			if (scenario === 'inn-away-back')
				tree.rerender(<CompanyLookup {...view} />)
		} else if (scenario === 'workspace')
			tree.rerender(
				<CompanyLookup
					{...view}
					workspaceId="22222222-2222-4222-8222-222222222222"
				/>
			)
		else if (scenario === 'scope')
			tree.rerender(<CompanyLookup {...view} scopeKey="changed" />)
		else if (scenario === 'write')
			tree.rerender(<CompanyLookup {...view} canWrite={false} />)
		else if (scenario === 'unmount') tree.unmount()
		else
			act(() =>
				useSessionStore.setState(
					scenario === 'revision'
						? { sessionRevision: 2 }
						: {
								session: {
									accessToken:
										scenario === 'token' ? 'new-token' : 'token',
									userId: scenario === 'subject' ? 'other-user' : 'user-1'
								}
							}
				)
			)
		await act(async () => pending.resolve(response))
		expect(screen.queryByText('Найденная компания')).toBeNull()
		expect(view.onApply).not.toHaveBeenCalled()
		expect(toast).not.toHaveBeenCalled()
	})
	it('discards a pending apply after an account reauthentication, even for the same subject', async () => {
		const view = props()
		render(<CompanyLookup {...view} />)
		await search()
		const pending = deferred<CrmPermissions>()
		vi.mocked(getCrmPermissions).mockReturnValue(pending.promise)
		fireEvent.click(
			screen.getByRole('button', { name: 'Заполнить форму' })
		)
		act(() => useSessionStore.setState({ sessionRevision: 2 }))
		await act(async () => pending.resolve(permissions))
		expect(view.onApply).not.toHaveBeenCalled()
		expect(screen.queryByText('Найденная компания')).toBeNull()
	})
	it('requires explicit overwrite before clearing an entrepreneur KPP', async () => {
		const individual = {
			...response,
			inn: '500100732259',
			items: [
				{
					...response.items[0],
					inn: '500100732259',
					entityType: 'INDIVIDUAL' as const,
					kpp: null,
					ogrn: '304500116000157'
				}
			]
		}
		vi.mocked(lookupCompany).mockResolvedValue(individual)
		const view = {
			...props(),
			inn: individual.inn,
			hasExisting: true,
			hasKpp: true
		}
		render(<CompanyLookup {...view} />)
		await search()
		expect(
			screen.getByRole('button', { name: 'Заполнить форму' })
		).toHaveProperty('disabled', true)
		fireEvent.click(
			screen.getByRole('checkbox', {
				name: /Заменить уже заполненные реквизиты/
			})
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Заполнить форму' })
		)
		await waitFor(() =>
			expect(view.onApply).toHaveBeenCalledWith(individual.items[0], true)
		)
	})
	it.each(['temporary', 'notFound', 'validation'] as const)(
		'keeps manual-entry guidance on %s failure without leaking raw response',
		async kind => {
			vi.mocked(lookupCompany).mockRejectedValue(
				new AuthenticatedApiError(kind, 'Поиск недоступен')
			)
			render(<CompanyLookup {...props()} />)
			fireEvent.click(
				screen.getByRole('button', { name: 'Найти реквизиты' })
			)
			expect((await screen.findByRole('alert')).textContent).toContain(
				'Ручное заполнение остаётся доступным'
			)
			expect(
				screen.queryByRole('button', { name: 'Заполнить форму' })
			).toBeNull()
		}
	)
	it('distinguishes confirmed empty result and warns about a liquidated company', async () => {
		vi.mocked(lookupCompany)
			.mockResolvedValueOnce({ ...response, items: [] })
			.mockResolvedValueOnce({
				...response,
				items: [{ ...response.items[0], status: 'LIQUIDATED' }]
			})
		render(<CompanyLookup {...props()} />)
		fireEvent.click(
			screen.getByRole('button', { name: 'Найти реквизиты' })
		)
		await screen.findByText('По этому ИНН ничего не найдено.')
		await search()
		await screen.findByText('Ликвидирована')
		expect(
			screen.getByRole('button', { name: 'Заполнить форму' })
		).toHaveProperty('disabled', false)
	})
	it('exposes no lookup action or request in read-only mode', () => {
		render(<CompanyLookup {...props()} canWrite={false} />)
		expect(screen.queryByRole('button')).toBeNull()
		expect(lookupCompany).not.toHaveBeenCalled()
	})
})
