import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	useCrmPermissions,
	useCrmWorkspaceAccess,
	type CrmPermissions
} from '@/entities/crm-access'
import { useAssigneeOptions } from '@/entities/crm-team'
import { useSessionStore } from '@/entities/session'
import { useReminderSession } from './use-reminder-session'
vi.mock('@/entities/crm-access', async original => ({
	...(await original<object>()),
	useCrmPermissions: vi.fn(),
	useCrmWorkspaceAccess: vi.fn()
}))
vi.mock('@/entities/crm-team', async original => ({
	...(await original<object>()),
	useAssigneeOptions: vi.fn()
}))
const workspaceId = '22222222-2222-4222-8222-222222222222'
const membershipId = '11111111-1111-4111-8111-111111111111'
let authority: CrmPermissions
let fetching: boolean
let selected: {
	subject: string
	membershipId: string
	role: string
} | null
beforeEach(() => {
	vi.clearAllMocks()
	authority = {
		schemaVersion: 1,
		workspaceId,
		subject: 'owner',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		permissions: ['sales:read', 'sales:write'],
		teamIds: []
	}
	fetching = false
	selected = { subject: 'owner', membershipId, role: 'OWNER' }
	useSessionStore.setState({
		session: { accessToken: 'token', userId: 'owner' },
		sessionRevision: 1,
		status: 'authenticated'
	})
	vi.mocked(useCrmPermissions).mockImplementation(
		() =>
			({ data: authority, isSuccess: true, isFetching: fetching }) as never
	)
	vi.mocked(useCrmWorkspaceAccess).mockReturnValue({
		workspaceId,
		canWrite: true
	} as never)
	vi.mocked(useAssigneeOptions).mockImplementation(
		() => ({ selected }) as never
	)
})
afterEach(cleanup)
describe('reminder actor/session binding', () => {
	it('proves owner null explicitly, never uses Identity membership as CRM membership', () => {
		const { result } = renderHook(useReminderSession)
		expect(result.current.actor).toEqual({
			subject: 'owner',
			membershipId: null
		})
		expect(result.current.actorConfirmed).toBe(true)
		expect(useAssigneeOptions).toHaveBeenCalledWith(expect.anything(), {
			selectedSubject: 'owner'
		})
	})
	it('preserves a proven draft binding during refresh but disables eligibility', () => {
		const { result, rerender } = renderHook(useReminderSession)
		fetching = true
		selected = null
		rerender()
		expect(result.current.actor).toEqual({
			subject: 'owner',
			membershipId: null
		})
		expect(result.current.actorConfirmed).toBe(false)
		expect(result.current.canRead).toBe(false)
		expect(result.current.current()).toBe(false)
		fetching = false
		selected = { subject: 'owner', membershipId, role: 'OWNER' }
		rerender()
		expect(result.current.actorConfirmed).toBe(true)
	})
	it('does not invent membership from a missing or foreign selected row', () => {
		selected = { subject: 'other', membershipId, role: 'OWNER' }
		const { result } = renderHook(useReminderSession)
		expect(result.current.actor).toBeNull()
		expect(result.current.actorConfirmed).toBe(false)
	})
	it('keeps a member exact ID and read-only access without write permission', () => {
		authority = {
			...authority,
			role: 'MANAGER',
			dataScope: 'OWN',
			state: 'READ_ONLY',
			permissions: ['sales:read']
		}
		selected = { subject: 'owner', membershipId, role: 'MANAGER' }
		const { result } = renderHook(useReminderSession)
		expect(result.current.actor).toEqual({
			subject: 'owner',
			membershipId
		})
		expect(result.current.canRead).toBe(true)
		expect(result.current.canWrite).toBe(false)
	})
	it('invalidates old callbacks immediately on session revision change', () => {
		const { result } = renderHook(useReminderSession)
		const previous = result.current.current
		act(() => useSessionStore.setState({ sessionRevision: 2 }))
		expect(previous()).toBe(false)
	})
})
