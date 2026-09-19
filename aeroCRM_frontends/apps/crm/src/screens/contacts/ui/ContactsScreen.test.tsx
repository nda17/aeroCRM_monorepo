import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	useCrmPermissions,
	useCrmWorkspaceAccess,
	type CrmPermissions
} from '@/entities/crm-access'
import { listCustomers } from '@/entities/customer'
import { useSessionStore } from '@/entities/session'
import ContactsPage from '@/app/(workspace)/contacts/page'
import ContactsScreen from './ContactsScreen'

vi.mock('@/entities/crm-access', async original => ({
	...(await original<typeof import('@/entities/crm-access')>()),
	useCrmPermissions: vi.fn(),
	useCrmWorkspaceAccess: vi.fn()
}))
vi.mock('@/entities/customer', async original => ({
	...(await original<typeof import('@/entities/customer')>()),
	listCustomers: vi.fn()
}))
vi.mock('@/features/edit-customer', () => ({
	CustomerEditor: ({
		id,
		canWrite,
		onClose
	}: {
		id?: string
		canWrite: boolean
		onClose: () => void
	}) => (
		<div role="dialog" aria-label="Карточка контакта">
			<span>{id}</span>
			<span>{canWrite ? 'Редактирование' : 'Только просмотр'}</span>
			<button onClick={onClose}>Закрыть карточку</button>
		</div>
	)
}))
vi.mock('@/features/export-records', () => ({
	ExportRecordsControl: () => <button>Экспорт</button>
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const contactId = '22222222-2222-4222-8222-222222222222'
let client: QueryClient
let permissions: CrmPermissions
const setPermissions = (confirmed = true) =>
	vi.mocked(useCrmPermissions).mockReturnValue({
		isSuccess: confirmed,
		isFetching: !confirmed,
		isError: false,
		data: confirmed ? permissions : undefined
	} as never)

beforeEach(() => {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	permissions = {
		schemaVersion: 1,
		workspaceId,
		subject: 'user-1',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [],
		permissions: ['customers:read', 'customers:write']
	}
	setPermissions()
	vi.mocked(useCrmWorkspaceAccess).mockReturnValue({
		workspaceId,
		canWrite: true
	} as never)
	vi.mocked(listCustomers).mockResolvedValue({
		schemaVersion: 1,
		items: [],
		page: 1,
		pageSize: 25,
		total: 0
	})
	useSessionStore.setState({
		session: { accessToken: 'token', userId: 'user-1' },
		sessionRevision: 1,
		status: 'authenticated'
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})

const view = (id: string | null = contactId) => (
	<QueryClientProvider client={client}>
		<ContactsScreen initialContactId={id} />
	</QueryClientProvider>
)

describe('Contact links', () => {
	it('opens a linked contact only after current permissions are confirmed and keeps read-only access', async () => {
		setPermissions(false)
		const rendered = render(view())
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(listCustomers).not.toHaveBeenCalled()
		permissions.permissions = ['customers:read']
		setPermissions()
		rendered.rerender(view())
		expect(await screen.findByRole('dialog')).toBeTruthy()
		expect(screen.getByText(contactId)).toBeTruthy()
		expect(screen.getByText('Только просмотр')).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', { name: 'Закрыть карточку' })
		)
		rendered.rerender(view())
		expect(screen.queryByRole('dialog')).toBeNull()
	})
	it('does not replay a link after workspace changes', async () => {
		const rendered = render(view())
		await screen.findByRole('dialog')
		vi.mocked(useCrmWorkspaceAccess).mockReturnValue({
			workspaceId: contactId,
			canWrite: true
		} as never)
		rendered.rerender(view())
		expect(screen.queryByRole('dialog')).toBeNull()
		vi.mocked(useCrmWorkspaceAccess).mockReturnValue({
			workspaceId,
			canWrite: true
		} as never)
		rendered.rerender(view())
		expect(screen.queryByRole('dialog')).toBeNull()
	})
	it('does not replay a link after permission scope changes', async () => {
		const rendered = render(view())
		await screen.findByRole('dialog')
		permissions.permissions = []
		setPermissions()
		rendered.rerender(view())
		expect(screen.queryByRole('dialog')).toBeNull()
		permissions.permissions = ['customers:read', 'customers:write']
		setPermissions()
		rendered.rerender(view())
		expect(screen.queryByRole('dialog')).toBeNull()
	})
	it('ignores invalid identifiers rather than opening a creation form', () => {
		render(view('not-an-id'))
		expect(screen.queryByRole('dialog')).toBeNull()
	})
	it.each([undefined, 'invalid', [contactId]])(
		'rejects ambiguous or invalid route input %s',
		async value => {
			const page = await ContactsPage({
				searchParams: Promise.resolve({ contactId: value })
			})
			expect(page.props.initialContactId).toBeNull()
		}
	)
	it('passes a validated identifier from the contacts route', async () => {
		const page = await ContactsPage({
			searchParams: Promise.resolve({ contactId })
		})
		expect(page.props.initialContactId).toBe(contactId)
	})
})
