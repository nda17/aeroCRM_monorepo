import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	listTeamOptions,
	listTeamRecords,
	mutateTeam,
	type TeamCommand
} from './team.api'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
const workspaceId = '11111111-1111-4111-8111-111111111111',
	id = '22222222-2222-4222-8222-222222222222',
	commandId = '33333333-3333-4333-8333-333333333333'
const now = '2026-09-05T12:00:00.000Z'
beforeEach(() => vi.clearAllMocks())
describe('CRM team commands', () => {
	it('reads actor-bound department labels without sending client authority or changing commands', async () => {
		const request = {
			workspaceId,
			subject: 'owner',
			teamIds: [id],
			page: 1,
			pageSize: 20,
			selectedId: id
		}
		const item = { id, name: 'Продажи' }
		const result = {
			schemaVersion: 1,
			workspaceId,
			subject: 'owner',
			page: 1,
			pageSize: 20,
			total: 1,
			items: [item],
			selected: item
		}
		vi.mocked(authenticatedRequest).mockResolvedValue(result)
		await expect(listTeamOptions('token', request)).resolves.toEqual(
			result
		)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/access/team/options',
			params: { workspaceId, page: '1', pageSize: '20', selectedId: id }
		})
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...result,
			subject: 'another-user'
		})
		await expect(listTeamOptions('token', request)).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
	it('sends exact UUID/CAS body and accepts only WAITING acknowledgment for enable', async () => {
		const command: TeamCommand = {
			workspaceId,
			commandId,
			mutation: { kind: 'enable', id, expectedVersion: 2 }
		}
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			admission: {
				id: commandId,
				workspaceId,
				memberId: id,
				status: 'WAITING',
				createdAt: now
			}
		})
		await expect(mutateTeam('token', command)).resolves.toEqual({
			kind: 'enable',
			id: commandId
		})
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'POST',
			url: `/crm/access/team/members/${id}/enable`,
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				expectedVersion: 2
			}
		})
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			admission: {
				id: commandId,
				workspaceId,
				memberId: id,
				status: 'ACTIVE',
				createdAt: now
			}
		})
		await expect(mutateTeam('token', command)).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
	it('binds team update acknowledgment to exact ID, version and normalized name', async () => {
		const command: TeamCommand = {
			workspaceId,
			commandId,
			mutation: {
				kind: 'rename-team',
				id,
				expectedVersion: 4,
				name: ' Продажи '
			}
		}
		const team = {
			id,
			workspaceId,
			name: 'Продажи',
			version: 5,
			archivedAt: null,
			createdAt: now,
			updatedAt: now
		}
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			team
		})
		await expect(mutateTeam('token', command)).resolves.toMatchObject({
			kind: 'rename-team'
		})
		for (const patch of [
			{ version: 6 },
			{ id: commandId },
			{ name: 'Не тот отдел' }
		]) {
			vi.mocked(authenticatedRequest).mockResolvedValue({
				schemaVersion: 1,
				team: { ...team, ...patch }
			})
			await expect(mutateTeam('token', command)).rejects.toMatchObject({
				kind: 'temporary'
			})
		}
	})
	it('sends custom role assignments and accepts only the same role binding in the response', async () => {
		const customRoleId = '44444444-4444-4444-8444-444444444444'
		const command: TeamCommand = {
			workspaceId,
			commandId,
			mutation: {
				kind: 'role',
				id,
				expectedVersion: 4,
				role: 'CUSTOM',
				customRoleId,
				expectedRoleVersion: 2
			}
		}
		const member = {
			id,
			workspaceId,
			subject: 'employee',
			membershipId: '55555555-5555-4555-8555-555555555555',
			role: 'CUSTOM',
			customRole: { id: customRoleId, name: 'Продажи', version: 2 },
			teamIds: [],
			disabledAt: null,
			version: 5,
			createdAt: now,
			updatedAt: now
		}
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			member
		})
		await expect(mutateTeam('token', command)).resolves.toEqual({
			kind: 'role',
			id
		})
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'POST',
			url: `/crm/access/team/members/${id}/change-role`,
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				expectedVersion: 4,
				role: 'CUSTOM',
				customRoleId,
				expectedRoleVersion: 2
			}
		})
		for (const customRole of [
			{
				id: '66666666-6666-4666-8666-666666666666',
				name: 'Продажи',
				version: 2
			},
			{ id: customRoleId, name: 'Продажи', version: 3 }
		]) {
			vi.mocked(authenticatedRequest).mockResolvedValue({
				schemaVersion: 1,
				member: { ...member, customRole }
			})
			await expect(mutateTeam('token', command)).rejects.toMatchObject({
				kind: 'temporary'
			})
		}
	})
	it('rejects a builtin mutation response that escalates into CUSTOM fields', async () => {
		const command: TeamCommand = {
			workspaceId,
			commandId,
			mutation: {
				kind: 'role',
				id,
				expectedVersion: 4,
				role: 'MANAGER'
			}
		}
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			member: {
				id,
				workspaceId,
				subject: 'employee',
				membershipId: '55555555-5555-4555-8555-555555555555',
				role: 'CUSTOM',
				customRole: {
					id: '44444444-4444-4444-8444-444444444444',
					name: 'Продажи',
					version: 2
				},
				teamIds: [],
				disabledAt: null,
				version: 5,
				createdAt: now,
				updatedAt: now
			}
		})
		await expect(mutateTeam('token', command)).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
	it('sends bounded server pagination instead of loading a workspace directory', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			page: 3,
			pageSize: 10,
			total: 0,
			items: []
		})
		await listTeamRecords('token', workspaceId, 'teams', 3, 10)
		expect(authenticatedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/crm/access/team/teams',
				params: { workspaceId, page: '3', pageSize: '10' }
			})
		)
	})
})
