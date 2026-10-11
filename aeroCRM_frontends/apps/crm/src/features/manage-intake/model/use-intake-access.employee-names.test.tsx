import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, type PropsWithChildren } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { CrmWorkspaceAccessProvider } from '@/entities/crm-access/model/crm-workspace-access.context'
import type { IntakeAccess } from './use-intake-access'
import { useIntakeAccess } from './use-intake-access'
import { useEmployeeNames } from '@/features/workspace-collaboration/model/use-employee-names'
import {
	resetSessionStore,
	useSessionStore
} from '@/entities/session/model/session.store'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<object>()),
		authenticatedRequest: vi.fn()
	})
)

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const membershipId = 'a1c1d3d9-dc5a-4a50-98ba-c79b3895db62'
const staffSubject = 'shared-staff'
const request = vi.mocked(authenticatedRequest)
const stamp = '2026-10-12T10:00:00.000Z'
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, gcTime: 0 } }
})

const access = {
	schemaVersion: 1 as const,
	state: 'ACTIVE' as const,
	selectedWorkspaceId: workspaceId,
	membership: { membershipId, role: 'OWNER' as const },
	workspaces: [],
	entitlementStatus: 'ACTIVE' as const,
	entitlement: {
		id: 'a2c1d3d9-dc5a-4a50-98ba-c79b3895db62',
		workspaceId,
		planCode: 'TEAM',
		seatLimit: 5,
		policyVersion: 1,
		graceUntil: null,
		trialStartedAt: null,
		effectiveFrom: stamp,
		effectiveUntil: stamp,
		aggregateVersion: '1',
		sourceSequence: '1'
	},
	access: { lifecycle: 'ACTIVE' as const }
}

const permissions = {
	schemaVersion: 1,
	workspaceId,
	subject: 'manager-subject',
	role: 'MANAGER',
	state: 'ACTIVE',
	dataScope: 'OWN',
	teamIds: [],
	permissions: ['intake:read', 'intake:write']
}

const employee = {
	id: '44444444-4444-4444-8444-444444444444',
	subject: staffSubject,
	membershipId,
	invitationId: null,
	status: 'ACTIVE',
	isOwner: false,
	displayName: 'Анна Смирнова',
	fields: {
		firstName: 'Анна',
		lastName: 'Смирнова',
		middleName: null,
		phone: null,
		email: null,
		position: null,
		department: null,
		extension: null,
		telegram: null
	},
	version: 1,
	archivedAt: null,
	updatedAt: stamp,
	canEdit: false,
	canArchive: false,
	canMessage: false
}

const Providers = ({ children }: PropsWithChildren) => {
	return (
		<QueryClientProvider client={queryClient}>
			<CrmWorkspaceAccessProvider access={access}>
				{children}
			</CrmWorkspaceAccessProvider>
		</QueryClientProvider>
	)
}

const ConditionalInboxPanel = () => {
	const intake = useIntakeAccess()
	if (!intake.canRead) return <p>Проверяем доступ</p>
	return <ReadyInboxPanel intake={intake} />
}

const ReadyInboxPanel = ({ intake }: { intake: IntakeAccess }) => {
	const employeeName = useEmployeeNames(intake)
	return <p>Принял: {employeeName(staffSubject)}</p>
}

afterEach(() => {
	cleanup()
	queryClient.clear()
	resetSessionStore()
	vi.clearAllMocks()
})

it('keeps the conditional inbox panel mounted while loading staff names without repeating permission reads', async () => {
	useSessionStore.getState().setAuthenticated({
		userId: 'manager-subject',
		accessToken: 'test-token'
	})
	request.mockImplementation(async config => {
		if (config.url === '/crm/access/permissions')
			return permissions as never
		if (config.url === '/crm/access/directory')
			return {
				schemaVersion: 1,
				workspaceId,
				subject: 'manager-subject',
				page: 1,
				pageSize: 100,
				total: 1,
				items: [employee]
			} as never
		throw new Error(`Unexpected request: ${config.method} ${config.url}`)
	})
	render(<ConditionalInboxPanel />, { wrapper: Providers })

	expect(await screen.findByText('Принял: Анна Смирнова')).toBeTruthy()
	await waitFor(() => {
		expect(
			request.mock.calls.filter(([config]) =>
				config.url?.endsWith('/permissions')
			)
		).toHaveLength(1)
		expect(
			request.mock.calls.filter(([config]) =>
				config.url?.endsWith('/directory')
			)
		).toHaveLength(1)
	})
})

it('loads employee names in StrictMode when the directory response settles after the effect remount', async () => {
	useSessionStore.getState().setAuthenticated({
		userId: 'manager-subject',
		accessToken: 'test-token'
	})
	let resolveDirectory!: (value: unknown) => void
	const deferredDirectory = new Promise<unknown>(resolve => {
		resolveDirectory = resolve
	})
	let permissionRequests = 0
	let directoryRequests = 0
	request.mockImplementation(async config => {
		if (config.url === '/crm/access/permissions') {
			permissionRequests++
			return permissions as never
		}
		if (config.url === '/crm/access/directory') {
			directoryRequests++
			return (await deferredDirectory) as never
		}
		throw new Error(`Unexpected request: ${config.method} ${config.url}`)
	})
	render(
		<StrictMode>
			<ConditionalInboxPanel />
		</StrictMode>,
		{ wrapper: Providers }
	)
	await waitFor(() => expect(directoryRequests).toBeGreaterThan(0))
	await act(async () => {
		resolveDirectory({
			schemaVersion: 1,
			workspaceId,
			subject: 'manager-subject',
			page: 1,
			pageSize: 100,
			total: 1,
			items: [employee]
		})
	})
	expect(await screen.findByText('Принял: Анна Смирнова')).toBeTruthy()
	expect(permissionRequests).toBeLessThanOrEqual(2)
	expect(directoryRequests).toBeLessThanOrEqual(2)
})

it('does not reuse a stale directory response when the session changes A to B and back to A', async () => {
	useSessionStore.getState().setAuthenticated({
		userId: 'manager-a',
		accessToken: 'token-a1'
	})
	let resolveFirstA!: (value: unknown) => void
	const firstAResponse = new Promise<unknown>(resolve => {
		resolveFirstA = resolve
	})
	let aDirectoryRequests = 0
	request.mockImplementation(async config => {
		const token = config.accessToken
		if (config.url === '/crm/access/permissions')
			return { ...permissions, subject: token === 'token-b' ? 'manager-b' : 'manager-a' } as never
		if (config.url === '/crm/access/directory') {
			if (token === 'token-a1') {
				aDirectoryRequests++
				if (aDirectoryRequests === 1) return (await firstAResponse) as never
				return directoryResponse('manager-a', 'Анна актуальная') as never
			}
			return token === 'token-b'
				? (directoryResponse('manager-b', 'Борис текущий') as never)
				: (directoryResponse('manager-a', 'Анна актуальная') as never)
		}
		throw new Error(`Unexpected request: ${config.method} ${config.url}`)
	})
	render(<ConditionalInboxPanel />, { wrapper: Providers })
	await waitFor(() => expect(aDirectoryRequests).toBe(1))

	act(() =>
		useSessionStore.getState().setAuthenticated({
			userId: 'manager-b',
			accessToken: 'token-b'
		})
	)
	expect(await screen.findByText('Принял: Борис текущий')).toBeTruthy()
	expect(screen.queryByText('Принял: Анна устаревшая')).toBeNull()

	act(() =>
		useSessionStore.getState().setAuthenticated({
			userId: 'manager-a',
			accessToken: 'token-a2'
		})
	)
	expect(await screen.findByText('Принял: Анна актуальная')).toBeTruthy()
	await act(async () => {
		resolveFirstA(directoryResponse('manager-a', 'Анна устаревшая'))
	})
	expect(screen.getByText('Принял: Анна актуальная')).toBeTruthy()
	expect(screen.queryByText('Принял: Анна устаревшая')).toBeNull()
})

const directoryResponse = (subject: string, displayName: string) => ({
	schemaVersion: 1,
	workspaceId,
	subject,
	page: 1,
	pageSize: 100,
	total: 1,
	items: [{ ...employee, subject: staffSubject, displayName }]
})
