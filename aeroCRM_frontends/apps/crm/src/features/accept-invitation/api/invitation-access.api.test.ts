import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	getCrmPermissions,
	parseCrmAccessBootstrap
} from '@/entities/crm-access'
import { checkInvitationCrmAccess } from './invitation-access.api'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<
			typeof import('@/shared/api/authenticated-http-client')
		>()),
		authenticatedRequest: vi.fn()
	})
)
vi.mock('@/entities/crm-access', async importOriginal => ({
	...(await importOriginal<typeof import('@/entities/crm-access')>()),
	getCrmPermissions: vi.fn(),
	parseCrmAccessBootstrap: vi.fn()
}))
const workspaceId = '22222222-2222-4222-8222-222222222222'
const bootstrap = {
	schemaVersion: 1,
	selectedWorkspaceId: workspaceId,
	state: 'ACTIVE',
	entitlement: {},
	access: { lifecycle: 'ACTIVE' }
}

describe('invitation CRM readiness', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(authenticatedRequest).mockResolvedValue({})
		vi.mocked(parseCrmAccessBootstrap).mockReturnValue(bootstrap as never)
	})
	it('does not treat bootstrap ACTIVE as CRM seat admission', async () => {
		vi.mocked(getCrmPermissions).mockRejectedValue(
			new Error('no admitted role')
		)
		await expect(
			checkInvitationCrmAccess('test-token', workspaceId, 'user-1')
		).rejects.toThrow('no admitted role')
		expect(authenticatedRequest).toHaveBeenCalledWith(
			expect.objectContaining({ method: 'GET', params: { workspaceId } })
		)
	})
	it('routes the confirmed analyst to analytics in the exact target workspace', async () => {
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'user-1',
			role: 'ANALYST',
			state: 'READ_ONLY'
		} as never)
		await expect(
			checkInvitationCrmAccess('test-token', workspaceId, 'user-1')
		).resolves.toEqual({
			workspaceId,
			state: 'READ_ONLY',
			destination: `/analytics?workspaceId=${workspaceId}`
		})
	})
	it('rejects a foreign subject or wrong/default bootstrap workspace', async () => {
		vi.mocked(getCrmPermissions).mockResolvedValue({
			subject: 'foreign',
			role: 'MANAGER',
			state: 'ACTIVE'
		} as never)
		await expect(
			checkInvitationCrmAccess('test-token', workspaceId, 'user-1')
		).rejects.toThrow()
		vi.mocked(parseCrmAccessBootstrap).mockReturnValue({
			...bootstrap,
			selectedWorkspaceId: '11111111-1111-4111-8111-111111111111'
		} as never)
		await expect(
			checkInvitationCrmAccess('test-token', workspaceId, 'user-1')
		).rejects.toThrow()
	})
})
