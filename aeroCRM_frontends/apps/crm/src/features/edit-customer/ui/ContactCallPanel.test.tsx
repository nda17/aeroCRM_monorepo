import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCustomer, type Customer } from '@/entities/customer'
import { getCrmPermissions } from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { openContactDialer } from '../model/contact-call'
import { ContactCallPanel } from './ContactCallPanel'

vi.mock('@/entities/customer', async original => ({
	...(await original<typeof import('@/entities/customer')>()),
	getCustomer: vi.fn()
}))
vi.mock('@/entities/crm-access', async original => ({
	...(await original<typeof import('@/entities/crm-access')>()),
	getCrmPermissions: vi.fn()
}))
vi.mock('../model/contact-call', async original => ({
	...(await original<typeof import('../model/contact-call')>()),
	openContactDialer: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { error: vi.fn() })
}))
const preferences = {
	timeZone: 'UTC',
	preferredCallStart: '09:00',
	preferredCallEnd: '18:00'
}
const contact: Customer = {
	kind: 'contacts',
	id: '11111111-1111-4111-8111-111111111111',
	workspaceId: '22222222-2222-4222-8222-222222222222',
	name: 'Клиент',
	phone: '+79001234567',
	email: null,
	companyId: null,
	notes: null,
	version: 1,
	teamId: null,
	archivedAt: null,
	createdAt: '2026-09-07T00:00:00Z',
	updatedAt: '2026-09-07T00:00:00Z',
	createdBySubject: 'owner',
	...preferences
}
beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(new Date('2026-09-07T20:00:00Z'))
	useSessionStore.setState({
		session: { accessToken: 'token', userId: 'owner' },
		sessionRevision: 1,
		status: 'authenticated'
	})
	vi.mocked(getCustomer).mockResolvedValue(contact)
	vi.mocked(getCrmPermissions).mockResolvedValue({
		subject: 'owner',
		workspaceId: contact.workspaceId,
		state: 'READ_ONLY',
		permissions: ['customers:read']
	} as never)
})
afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.useRealTimers()
})
const mount = (record = contact) =>
	render(
		<ContactCallPanel
			value={preferences}
			onChange={vi.fn()}
			editable={false}
			disabled={false}
			record={record}
		/>
	)

describe('contact call action', () => {
	it('allows read-only viewing/calling but requires explicit confirmation outside saved hours', async () => {
		const confirm = vi
			.spyOn(window, 'confirm')
			.mockReturnValueOnce(false)
			.mockReturnValueOnce(true)
		mount()
		expect(screen.getByLabelText('Часовой пояс клиента')).toHaveProperty(
			'disabled',
			true
		)
		fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }))
		await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
		expect(openContactDialer).not.toHaveBeenCalled()
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Позвонить' })
			).toHaveProperty('disabled', false)
		)
		fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }))
		await waitFor(() =>
			expect(openContactDialer).toHaveBeenCalledExactlyOnceWith(
				contact.phone
			)
		)
	})
	it('recomputes current local time on click rather than using the visible minute snapshot', async () => {
		vi.setSystemTime(new Date('2026-09-07T17:59:00Z'))
		mount()
		const confirm = vi
			.spyOn(window, 'confirm')
			.mockImplementation(message => {
				expect(message).toContain('18:00')
				vi.setSystemTime(new Date('2026-09-07T18:10:00Z'))
				return true
			})
		vi.setSystemTime(new Date('2026-09-07T18:00:00Z'))
		fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }))
		await waitFor(() => expect(openContactDialer).toHaveBeenCalledOnce())
		expect(confirm).toHaveBeenCalledOnce()
	})
	it('does not infer a timezone or daytime when client preferences are absent', async () => {
		const unknown = {
			...contact,
			timeZone: null,
			preferredCallStart: null,
			preferredCallEnd: null
		}
		vi.mocked(getCustomer).mockResolvedValue(unknown)
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
		mount(unknown)
		expect(screen.getByText('Время звонка не настроено')).toBeTruthy()
		expect(
			screen.getByText(
				/по сохранённой карточке: часовой пояс клиента не указан/i
			)
		).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }))
		await waitFor(() =>
			expect(confirm).toHaveBeenCalledWith(
				expect.stringContaining('неизвестно')
			)
		)
		expect(openContactDialer).not.toHaveBeenCalled()
	})
	it('drops a late read after session change and never calls another actor’s contact', async () => {
		let resolve!: (value: Customer) => void
		vi.mocked(getCustomer).mockReturnValue(
			new Promise(done => {
				resolve = done
			})
		)
		mount()
		fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }))
		await waitFor(() => expect(getCustomer).toHaveBeenCalled())
		useSessionStore.setState({ sessionRevision: 2 })
		resolve(contact)
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Позвонить' })
			).toHaveProperty('disabled', false)
		)
		expect(openContactDialer).not.toHaveBeenCalled()
	})
	it('does not call after a version conflict', async () => {
		vi.mocked(getCustomer).mockResolvedValue({ ...contact, version: 2 })
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
		mount()
		fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }))
		await waitFor(() => expect(getCustomer).toHaveBeenCalled())
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Позвонить' })
			).toHaveProperty('disabled', false)
		)
		expect(confirm).not.toHaveBeenCalled()
		expect(openContactDialer).not.toHaveBeenCalled()
	})
	it('does not read or call a contact after read permission denial', async () => {
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'owner',
			workspaceId: contact.workspaceId,
			permissions: []
		} as never)
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
		mount()
		fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }))
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Позвонить' })
			).toHaveProperty('disabled', false)
		)
		expect(getCustomer).not.toHaveBeenCalled()
		expect(confirm).not.toHaveBeenCalled()
		expect(openContactDialer).not.toHaveBeenCalled()
	})
})
