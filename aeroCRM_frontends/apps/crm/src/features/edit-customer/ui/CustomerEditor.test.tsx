import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	findCustomerDuplicates,
	getCustomer,
	listCustomers,
	mutateCustomer,
	lookupCompany,
	type Customer
} from '@/entities/customer'
import { useSessionStore } from '@/entities/session'
import { getCrmPermissions } from '@/entities/crm-access'
import {
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { CustomerEditor } from './CustomerEditor'

vi.mock('@/entities/customer', async importOriginal => ({
	...(await importOriginal<typeof import('@/entities/customer')>()),
	getCustomer: vi.fn(),
	listCustomers: vi.fn(),
	mutateCustomer: vi.fn(),
	findCustomerDuplicates: vi.fn(),
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
const contact: Customer = {
	kind: 'contacts',
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	name: 'Клиент QA',
	notes: null,
	createdBySubject: 'user-1',
	teamId: null,
	version: 3,
	archivedAt: null,
	createdAt: '2026-09-05T00:00:00.000Z',
	updatedAt: '2026-09-05T00:00:00.000Z',
	phone: null,
	email: null,
	companyId: null
}
const company: Customer = {
	kind: 'companies',
	id: '66666666-6666-4666-8666-666666666666',
	workspaceId,
	name: 'ООО Ромашка',
	notes: null,
	createdBySubject: 'user-1',
	teamId: null,
	version: 1,
	archivedAt: null,
	createdAt: contact.createdAt,
	updatedAt: contact.updatedAt,
	inn: null,
	website: null,
	legalName: null,
	kpp: null,
	ogrn: null,
	legalAddress: null,
	entityType: null
}
let client: QueryClient
const submitEditor = (label = 'Сохранить') =>
	fireEvent.submit(
		(screen.getByRole('button', { name: label }) as HTMLButtonElement).form!
	)

beforeEach(() => {
	vi.clearAllMocks()
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
	useSessionStore.setState({
		session: { accessToken: 'token', userId: 'user-1' },
		status: 'authenticated',
		sessionRevision: 1
	})
	vi.mocked(listCustomers).mockResolvedValue({
		schemaVersion: 1,
		items: [],
		page: 1,
		pageSize: 25,
		total: 0
	})
	vi.mocked(getCustomer).mockResolvedValue(contact)
	vi.mocked(mutateCustomer).mockResolvedValue(contact)
	vi.mocked(getCrmPermissions).mockResolvedValue({
		workspaceId,
		subject: 'user-1',
		state: 'ACTIVE',
		permissions: ['customers:write']
	} as never)
})

describe('CompanyEditor explicit requisites workflow', () => {
	const company: Customer = {
		kind: 'companies',
		id: contact.id,
		workspaceId,
		name: 'Моя компания',
		notes: 'Мои заметки',
		createdBySubject: 'user-1',
		teamId: null,
		version: 3,
		archivedAt: null,
		createdAt: contact.createdAt,
		updatedAt: contact.updatedAt,
		inn: '7707083893',
		website: 'https://example.test',
		legalName: null,
		kpp: '123456789',
		ogrn: null,
		legalAddress: null,
		entityType: null
	}
	const item = {
		name: 'Название из справочника',
		legalName: 'Полное название из справочника',
		inn: '7707083893',
		kpp: '770701001',
		ogrn: '1027700132195',
		legalAddress: 'Москва, адрес',
		entityType: 'LEGAL' as const,
		status: 'ACTIVE' as const
	}
	const mountCompany = (canWrite = true, id?: string) => {
		vi.mocked(getCustomer).mockResolvedValue(company)
		vi.mocked(mutateCustomer).mockResolvedValue(company)
		vi.mocked(lookupCompany).mockResolvedValue({
			schemaVersion: 1,
			provider: 'DADATA',
			queriedAt: contact.updatedAt,
			inn: item.inn,
			items: [item]
		})
		const onSaved = vi.fn(),
			onClose = vi.fn()
		render(
			<QueryClientProvider client={client}>
				<PendingCommandProvider owner={commandOwner('user-1', 1)}>
					<CustomerEditor
						workspaceId={workspaceId}
						kind="companies"
						id={id}
						canWrite={canWrite}
						onSaved={onSaved}
						onClose={onClose}
					/>
				</PendingCommandProvider>
			</QueryClientProvider>
		)
		return { onSaved, onClose }
	}
	const findAndApply = async (overwrite = false) => {
		fireEvent.click(
			await screen.findByRole('button', { name: 'Найти реквизиты' })
		)
		await screen.findByText(item.name)
		if (overwrite)
			fireEvent.click(
				screen.getByRole('checkbox', {
					name: /Заменить уже заполненные реквизиты/
				})
			)
		fireEvent.click(
			screen.getByRole('button', { name: 'Заполнить форму' })
		)
		await waitFor(() =>
			expect(
				screen.getByRole('textbox', { name: 'Полное наименование' })
			).toHaveProperty('value', item.legalName)
		)
	}
	it('fills only empty requisites and never autosaves or overwrites name, KPP, notes and website', async () => {
		const callbacks = mountCompany(true, company.id)
		await findAndApply()
		expect(
			screen.getByRole('textbox', { name: 'Название компании' })
		).toHaveProperty('value', company.name)
		expect(screen.getByRole('textbox', { name: 'КПП' })).toHaveProperty(
			'value',
			company.kpp
		)
		expect(screen.getByRole('textbox', { name: 'Сайт' })).toHaveProperty(
			'value',
			company.website
		)
		expect(
			screen.getByRole('textbox', { name: 'Заметки' })
		).toHaveProperty('value', company.notes)
		expect(
			screen.getByRole('combobox', { name: 'Тип организации' })
		).toHaveProperty('value', 'LEGAL')
		expect(mutateCustomer).not.toHaveBeenCalled()
		expect(callbacks.onClose).not.toHaveBeenCalled()
		submitEditor()
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			schemaVersion: 2,
			kind: 'companies',
			id: company.id,
			expectedVersion: 3,
			fields: {
				name: company.name,
				kpp: company.kpp,
				legalName: item.legalName,
				legalAddress: item.legalAddress,
				ogrn: item.ogrn,
				entityType: 'LEGAL',
				notes: company.notes,
				website: company.website
			}
		})
	})
	it('replaces populated requisites only after an explicit checkbox, not unrelated fields', async () => {
		mountCompany(true, company.id)
		await findAndApply(true)
		expect(
			screen.getByRole('textbox', { name: 'Название компании' })
		).toHaveProperty('value', item.name)
		expect(screen.getByRole('textbox', { name: 'КПП' })).toHaveProperty(
			'value',
			item.kpp
		)
		expect(
			screen.getByRole('textbox', { name: 'Заметки' })
		).toHaveProperty('value', company.notes)
		expect(mutateCustomer).not.toHaveBeenCalled()
	})
	it('preserves manual INN length-only validation independently of the optional lookup checksum', async () => {
		mountCompany()
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название компании' }),
			{ target: { value: 'Вручную' } }
		)
		fireEvent.change(screen.getByRole('textbox', { name: 'ИНН' }), {
			target: { value: '1234567890' }
		})
		submitEditor()
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			schemaVersion: 2,
			fields: {
				inn: '1234567890',
				legalName: null,
				kpp: null,
				ogrn: null,
				legalAddress: null,
				entityType: null
			}
		})
		expect(lookupCompany).not.toHaveBeenCalled()
	})
	it('keeps manual editing and explicit save usable after a provider outage', async () => {
		mountCompany(true, company.id)
		vi.mocked(lookupCompany).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Поиск недоступен')
		)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Найти реквизиты' })
		)
		await screen.findByRole('alert')
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Полное наименование' }),
			{ target: { value: 'Введено вручную' } }
		)
		submitEditor()
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			schemaVersion: 2,
			fields: { legalName: 'Введено вручную' }
		})
	})
	it('freezes an uncertain company v2 command, with no lookup action, and replays its exact requisites', async () => {
		mountCompany(true, company.id)
		vi.mocked(mutateCustomer)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Ответ потерян')
			)
			.mockResolvedValueOnce(company)
		fireEvent.change(
			await screen.findByRole('textbox', { name: 'Полное наименование' }),
			{ target: { value: 'Зафиксированный черновик' } }
		)
		submitEditor()
		await screen.findByRole('button', { name: 'Повторить запрос' })
		expect(
			screen.queryByRole('button', { name: 'Найти реквизиты' })
		).toBeNull()
		expect(
			screen.getByRole('textbox', { name: 'Полное наименование' })
		).toHaveProperty('readOnly', true)
		const original = vi.mocked(mutateCustomer).mock.calls[0][1]
		expect(original.schemaVersion).toBe(2)
		submitEditor('Повторить запрос')
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateCustomer).mock.calls[1][1]).toEqual(original)
		expect(lookupCompany).not.toHaveBeenCalled()
	})
	it('keeps v2 requisites readable, with no lookup/save or archive actions in READ_ONLY', async () => {
		mountCompany(false, company.id)
		expect(
			await screen.findByRole('textbox', { name: 'КПП' })
		).toHaveProperty('value', company.kpp)
		for (const label of [
			'КПП',
			'Полное наименование',
			'Юридический адрес'
		])
			expect(screen.getByRole('textbox', { name: label })).toHaveProperty(
				'readOnly',
				true
			)
		expect(
			screen.queryByRole('button', { name: 'Найти реквизиты' })
		).toBeNull()
		expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
		expect(lookupCompany).not.toHaveBeenCalled()
	})
	it('archives existing companies using an explicit v2 command with CAS', async () => {
		mountCompany(true, company.id)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Архивировать запись' })
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить архивирование' })
		)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			schemaVersion: 2,
			archive: true,
			id: company.id,
			expectedVersion: 3
		})
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})
const mount = (canWrite = true, id?: string, initialName?: string) => {
	const onSaved = vi.fn()
	const onClose = vi.fn()
	render(
		<QueryClientProvider client={client}>
			<PendingCommandProvider owner={commandOwner('user-1', 1)}>
				<CustomerEditor
					workspaceId={workspaceId}
					kind="contacts"
					id={id}
					initialName={initialName}
					canWrite={canWrite}
					onSaved={onSaved}
					onClose={onClose}
				/>
			</PendingCommandProvider>
		</QueryClientProvider>
	)
	return { onSaved, onClose }
}
describe('CustomerEditor', () => {
	it('formats pasted local phones and sends E164 with the saved contact to the caller', async () => {
		const callbacks = mount(true, undefined, 'Новый клиент из сделки')
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'value',
			'Новый клиент из сделки'
		)
		const phone = screen.getByRole('textbox', { name: 'Телефон' })
		fireEvent.change(phone, { target: { value: '8 (999) 123-45-67' } })
		expect(phone).toHaveProperty('value', '+7 999 123 45 67')
		submitEditor()
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledOnce())
		expect(
			vi.mocked(mutateCustomer).mock.calls[0][1].fields
		).toMatchObject({
			name: 'Новый клиент из сделки',
			phone: '+79991234567'
		})
		expect(callbacks.onSaved).toHaveBeenCalledWith(contact)
	})
	it('normalizes the duplicate lookup independently of the displayed phone', async () => {
		vi.mocked(findCustomerDuplicates).mockResolvedValue({
			schemaVersion: 1,
			items: [],
			page: 1,
			pageSize: 25,
			total: 0
		})
		mount()
		fireEvent.change(screen.getByRole('textbox', { name: 'Телефон' }), {
			target: { value: '+44 (20) 7946-0018' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить совпадения' })
		)
		await waitFor(() =>
			expect(findCustomerDuplicates).toHaveBeenCalledWith(
				'token',
				workspaceId,
				'+442079460018',
				''
			)
		)
	})
	it.each(['+74951234567', '+998901234567', '+123456789012345'])(
		'preserves an existing international or landline number %s when editing other fields',
		async phone => {
			vi.mocked(getCustomer).mockResolvedValue({ ...contact, phone })
			mount(true, contact.id)
			fireEvent.change(
				await screen.findByRole('textbox', { name: 'Имя' }),
				{
					target: { value: 'Новое имя' }
				}
			)
			submitEditor()
			await waitFor(() => expect(mutateCustomer).toHaveBeenCalledOnce())
			expect(
				vi.mocked(mutateCustomer).mock.calls[0][1].fields
			).toMatchObject({ phone })
		}
	)
	it('blocks an overlong phone without truncating it into a different number', async () => {
		mount(true, undefined, 'Клиент')
		const phone = screen.getByRole('textbox', { name: 'Телефон' })
		fireEvent.change(phone, { target: { value: '+1234567890123456' } })
		submitEditor()
		await screen.findByText('Проверьте правильность ввода номера телефона')
		expect(phone).toHaveProperty('value', '+1234567890123456')
		expect(mutateCustomer).not.toHaveBeenCalled()
	})
	it('keeps an unsaved draft and its version when a live refresh finds a remote edit', async () => {
		mount(true, contact.id)
		const input = await screen.findByRole('textbox', { name: 'Имя' })
		fireEvent.change(input, { target: { value: 'Мой черновик' } })
		vi.mocked(getCustomer).mockResolvedValue({
			...contact,
			name: 'Чужое изменение',
			version: 4
		})
		await client.invalidateQueries({ queryKey: ['crm-customer-detail'] })
		await waitFor(() => expect(getCustomer).toHaveBeenCalledTimes(2))
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'value',
			'Мой черновик'
		)
		expect(mutateCustomer).not.toHaveBeenCalled()
		expect(
			screen
				.getByRole('button', { name: 'Сохранить' })
				.hasAttribute('disabled')
		).toBe(true)
	})
	it('saves explicit contact timezone and an overnight call window as v2 without autosave', async () => {
		mount(true, contact.id)
		await screen.findByRole('textbox', { name: 'Имя' })
		fireEvent.change(screen.getByLabelText('Часовой пояс клиента'), {
			target: { value: 'Asia/Vladivostok' }
		})
		fireEvent.change(screen.getByLabelText('Удобно звонить с'), {
			target: { value: '22:00' }
		})
		fireEvent.change(screen.getByLabelText('Удобно звонить до'), {
			target: { value: '06:00' }
		})
		expect(mutateCustomer).not.toHaveBeenCalled()
		submitEditor()
		await waitFor(() =>
			expect(mutateCustomer).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({
					schemaVersion: 2,
					expectedVersion: contact.version,
					fields: expect.objectContaining({
						timeZone: 'Asia/Vladivostok',
						preferredCallStart: '22:00',
						preferredCallEnd: '06:00'
					})
				})
			)
		)
	})
	it('keeps the company-picker workspace prefix invalidatable while isolating its v2 cache', async () => {
		mount()
		await waitFor(() => expect(listCustomers).toHaveBeenCalled())
		const keys = client
			.getQueryCache()
			.findAll({ queryKey: ['crm-company-picker', workspaceId] })
			.map(query => query.queryKey)
		expect(keys).toHaveLength(1)
		expect(keys[0].slice(0, 3)).toEqual([
			'crm-company-picker',
			workspaceId,
			2
		])
	})
	it('saves an inline company without submitting the contact and keeps the contact draft selected', async () => {
		const callbacks = mount(true, undefined, 'Новый контакт')
		vi.mocked(mutateCustomer).mockResolvedValueOnce(company)
		fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
			target: { value: 'Черновик контакта' }
		})
		fireEvent.change(screen.getByRole('textbox', { name: 'Найти компанию' }), {
			target: { value: 'ООО Ромашка' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Создать компанию' }))
		const child = await screen.findByRole('dialog', { name: 'Новая компания' })
		const childName = within(child).getByRole('textbox', {
			name: 'Название компании'
		})
		expect(childName).toHaveProperty('value', 'ООО Ромашка')
		fireEvent.click(within(child).getByRole('button', { name: 'Сохранить' }))
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			kind: 'companies',
			fields: { name: 'ООО Ромашка' }
		})
		expect(callbacks.onSaved).not.toHaveBeenCalled()
		expect(callbacks.onClose).not.toHaveBeenCalled()
		await waitFor(() =>
			expect(screen.queryByRole('dialog', { name: 'Новая компания' })).toBeNull()
		)
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'value',
			'Черновик контакта'
		)
		await waitFor(() =>
			expect(
				screen.getByRole('combobox', { name: 'Компания' })
			).toHaveProperty('value', company.id)
		)
		expect(screen.getByRole('option', { name: company.name })).toBeTruthy()
	})
	it('cancelling inline company creation preserves the contact draft and previous company', async () => {
		vi.mocked(listCustomers).mockResolvedValue({
			schemaVersion: 1,
			items: [company],
			page: 1,
			pageSize: 25,
			total: 1
		})
		mount(true, undefined, 'Исходный контакт')
		const name = screen.getByRole('textbox', { name: 'Имя' })
		fireEvent.change(name, { target: { value: 'Черновик контакта' } })
		const companySelect = screen.getByRole('combobox', { name: 'Компания' })
		await waitFor(() => expect(companySelect).toHaveProperty('value', ''))
		await screen.findByRole('option', { name: company.name })
		fireEvent.change(companySelect, { target: { value: company.id } })
		fireEvent.click(screen.getByRole('button', { name: 'Создать компанию' }))
		const child = await screen.findByRole('dialog', { name: 'Новая компания' })
		fireEvent.click(within(child).getByRole('button', { name: 'Закрыть' }))
		await waitFor(() =>
			expect(screen.queryByRole('dialog', { name: 'Новая компания' })).toBeNull()
		)
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'value',
			'Черновик контакта'
		)
		expect(companySelect).toHaveProperty('value', company.id)
	})
	it('retries an uncertain inline company command with the same payload and does not create a duplicate', async () => {
		const callbacks = mount(true, undefined, 'Новый контакт')
		vi.mocked(mutateCustomer)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Ответ потерян')
			)
			.mockResolvedValueOnce(company)
		fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
			target: { value: 'Черновик контакта' }
		})
		fireEvent.change(screen.getByRole('textbox', { name: 'Найти компанию' }), {
			target: { value: 'ООО Ромашка' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Создать компанию' }))
		const child = await screen.findByRole('dialog', { name: 'Новая компания' })
		fireEvent.click(within(child).getByRole('button', { name: 'Сохранить' }))
		const retry = await within(child).findByRole('button', {
			name: 'Повторить запрос'
		})
		const firstCommand = vi.mocked(mutateCustomer).mock.calls[0][1]
		expect(
			within(child).getByRole('textbox', { name: 'Название компании' })
		).toHaveProperty('readOnly', true)
		fireEvent.click(retry)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateCustomer).mock.calls[1][1]).toEqual(firstCommand)
		await waitFor(() =>
			expect(screen.queryByRole('dialog', { name: 'Новая компания' })).toBeNull()
		)
		expect(callbacks.onSaved).not.toHaveBeenCalled()
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'value',
			'Черновик контакта'
		)
		expect(screen.getByRole('combobox', { name: 'Компания' })).toHaveProperty(
			'value',
			company.id
		)
	})
	it('hides inline company creation when contact writing is unavailable', async () => {
		mount(false, undefined, 'Только просмотр')
		expect(
			screen.queryByRole('button', { name: 'Создать компанию' })
		).toBeNull()
		expect(screen.getByRole('combobox', { name: 'Компания' })).toHaveProperty(
			'disabled',
			true
		)
	})
	it('loads real records and keeps read-only fields viewable without mutation controls', async () => {
		mount(false, contact.id)
		expect(
			await screen.findByRole('textbox', { name: 'Имя' })
		).toHaveProperty('readOnly', true)
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'value',
			'Клиент QA'
		)
		expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
		expect(mutateCustomer).not.toHaveBeenCalled()
	})
	it('sends the current record version and closes only after confirmed success', async () => {
		const callbacks = mount(true, contact.id)
		fireEvent.change(await screen.findByRole('textbox', { name: 'Имя' }), {
			target: { value: 'Изменённое имя' }
		})
		submitEditor()
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			workspaceId,
			id: contact.id,
			expectedVersion: 3,
			fields: {
				name: 'Изменённое имя',
				phone: null,
				email: null,
				teamId: null
			}
		})
		await waitFor(() => expect(callbacks.onClose).toHaveBeenCalledTimes(1))
	})
	it('freezes an uncertain command and retries its exact id and payload', async () => {
		vi.mocked(mutateCustomer)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Сеть недоступна')
			)
			.mockResolvedValueOnce(contact)
		mount()
		fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
			target: { value: 'Новый клиент' }
		})
		submitEditor()
		await screen.findByRole('button', { name: 'Повторить запрос' })
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'readOnly',
			true
		)
		submitEditor('Повторить запрос')
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateCustomer).mock.calls[1][1]).toEqual(
			vi.mocked(mutateCustomer).mock.calls[0][1]
		)
	})
	it('requires an explicit confirmation before archive', async () => {
		mount(true, contact.id)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Архивировать запись' })
		)
		expect(mutateCustomer).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить архивирование' })
		)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			archive: true,
			id: contact.id,
			expectedVersion: 3
		})
	})
	it('does not silently overwrite a concurrent edit', async () => {
		vi.mocked(mutateCustomer).mockRejectedValue(
			new AuthenticatedApiError('conflict', 'Версия изменилась')
		)
		mount(true, contact.id)
		await screen.findByRole('textbox', { name: 'Имя' })
		submitEditor()
		await screen.findByRole('button', {
			name: 'Загрузить актуальную версию'
		})
		expect(
			screen.getByRole('button', { name: 'Сохранить' })
		).toHaveProperty('disabled', true)
		expect(mutateCustomer).toHaveBeenCalledTimes(1)
	})
})
