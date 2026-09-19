import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropsWithChildren } from 'react'
import {
	crmPermissionScope,
	getCrmPermissions,
	type CrmPermissions
} from '@/entities/crm-access'
import { listAssigneeOptions } from '@/entities/crm-team'
import {
	mutateReminderRule,
	type ReminderCommand
} from '@/entities/crm-reminders'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useReminderCommand } from './use-reminder-command'
import type { ReminderContext } from './use-reminder-session'
vi.mock('@/entities/crm-access', async original => ({
	...(await original<object>()),
	getCrmPermissions: vi.fn()
}))
vi.mock('@/entities/crm-team', async original => ({
	...(await original<object>()),
	listAssigneeOptions: vi.fn()
}))
vi.mock('@/entities/crm-reminders', async original => ({
	...(await original<object>()),
	mutateReminderRule: vi.fn()
}))
const workspaceId = '22222222-2222-4222-8222-222222222222'
const authority: CrmPermissions = {
	schemaVersion: 1,
	workspaceId,
	subject: 'owner',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['sales:read', 'sales:write']
}
const command: ReminderCommand = {
	workspaceId,
	commandId: '11111111-1111-4111-8111-111111111111',
	actor: { subject: 'owner', membershipId: null },
	action: 'create',
	rule: {
		schemaVersion: 1,
		id: '33333333-3333-4333-8333-333333333333',
		scope: 'PERSONAL',
		ownerBinding: { subject: 'owner', membershipId: null },
		title: 'Правило',
		enabled: false,
		channels: [],
		trigger: { kind: 'AT_DUE', offsetMinutes: 0 },
		repeats: null,
		timeZone: 'UTC',
		quietHours: null,
		recipients: { kind: 'SELF' }
	}
}
let client: QueryClient
let current: boolean
const context = () =>
	({
		workspace: { workspaceId },
		session: { userId: 'owner', accessToken: 'token' },
		sessionRevision: 1,
		scopeKey: crmPermissionScope(authority),
		actor: command.actor,
		current: () => current
	}) as ReminderContext
const wrapper = ({ children }: PropsWithChildren) => (
	<QueryClientProvider client={client}>
		<PendingCommandProvider owner={commandOwner('owner', 1)}>
			{children}
		</PendingCommandProvider>
	</QueryClientProvider>
)
beforeEach(() => {
	vi.clearAllMocks()
	current = true
	client = new QueryClient()
	vi.mocked(getCrmPermissions).mockResolvedValue(authority)
	vi.mocked(listAssigneeOptions).mockResolvedValue({
		selected: {
			subject: 'owner',
			role: 'OWNER',
			membershipId: '44444444-4444-4444-8444-444444444444'
		}
	} as never)
	vi.mocked(mutateReminderRule).mockResolvedValue({
		schemaVersion: 1,
		deliveryReady: false
	} as never)
})
afterEach(() => {
	cleanup()
	client.clear()
})
describe('reminder command coordinator', () => {
	it('replays the identical UUID and payload after unknown result and reauthorizes', async () => {
		vi.mocked(mutateReminderRule).mockRejectedValueOnce(
			new AuthenticatedApiError('temporary', 'Unknown')
		)
		const saved = vi.fn()
		const { result } = renderHook(
			() => useReminderCommand(context(), 'PERSONAL', true, saved),
			{ wrapper }
		)
		await act(() => result.current.execute(() => command))
		expect(result.current.uncertain).toBe(true)
		await act(() =>
			result.current.execute(() => ({
				...command,
				commandId: workspaceId
			}))
		)
		expect(
			vi.mocked(mutateReminderRule).mock.calls.map(call => call[1])
		).toEqual([command, command])
		expect(getCrmPermissions).toHaveBeenCalledTimes(2)
		expect(saved).toHaveBeenCalledOnce()
	})
	it.each(['READ_ONLY', 'another-actor', 'missing-membership'])(
		'refuses fresh invalid authority %s',
		async reason => {
			if (reason === 'missing-membership')
				vi.mocked(listAssigneeOptions).mockResolvedValue({
					selected: null
				} as never)
			else
				vi.mocked(getCrmPermissions).mockResolvedValue({
					...authority,
					...(reason === 'READ_ONLY'
						? { state: 'READ_ONLY' }
						: { subject: 'another' })
				})
			const { result } = renderHook(
				() => useReminderCommand(context(), 'PERSONAL', true, vi.fn()),
				{ wrapper }
			)
			await act(() => result.current.execute(() => command))
			expect(mutateReminderRule).not.toHaveBeenCalled()
		}
	)
	it('drops an authorization response after session/workspace lifetime changes', async () => {
		vi.mocked(getCrmPermissions).mockImplementation(async () => {
			current = false
			return authority
		})
		const saved = vi.fn()
		const { result } = renderHook(
			() => useReminderCommand(context(), 'PERSONAL', true, saved),
			{ wrapper }
		)
		await act(() => result.current.execute(() => command))
		expect(mutateReminderRule).not.toHaveBeenCalled()
		expect(saved).not.toHaveBeenCalled()
	})
})
