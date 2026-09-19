import { describe, expect, it } from 'vitest'
import { parseCrmPermissions, crmPermissionScope } from './crm-permissions'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const base = {
	schemaVersion: 1,
	workspaceId,
	subject: 'user-1',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['customers:read', 'customers:write', 'customers:export']
}
describe('workspace permission contract', () => {
	it.each(['OWNER', 'CRM_ADMIN'])(
		'allows read-team in READ_ONLY for %s but denies revoke-access',
		role => {
			expect(
				parseCrmPermissions(
					{
						...base,
						role,
						state: 'READ_ONLY',
						permissions: ['access:read-team']
					},
					workspaceId
				)
			).not.toBeNull()
			expect(
				parseCrmPermissions(
					{
						...base,
						role,
						state: 'READ_ONLY',
						permissions: ['access:revoke-access']
					},
					workspaceId
				)
			).toBeNull()
			expect(
				parseCrmPermissions(
					{
						...base,
						role,
						permissions: ['access:read-team', 'access:revoke-access']
					},
					workspaceId
				)
			).not.toBeNull()
		}
	)
	it.each(['TEAM_LEAD', 'MANAGER', 'ANALYST'])(
		'rejects elevated team permissions for %s',
		role => {
			for (const permission of [
				'access:read-team',
				'access:revoke-access'
			])
				expect(
					parseCrmPermissions(
						{
							...base,
							role,
							dataScope:
								role === 'MANAGER'
									? 'OWN'
									: role === 'TEAM_LEAD'
										? 'TEAM'
										: 'ALL',
							permissions: [permission]
						},
						workspaceId
					)
				).toBeNull()
		}
	)
	it('partitions cached records when role, row scope, teams or permissions change', () => {
		const owner = parseCrmPermissions(base, workspaceId)!
		const before = crmPermissionScope(owner)
		for (const change of [
			{ role: 'CRM_ADMIN' as const },
			{ dataScope: 'TEAM' as const },
			{ teamIds: ['22222222-2222-4222-8222-222222222222'] },
			{ permissions: ['customers:read'] }
		])
			expect(crmPermissionScope({ ...owner, ...change })).not.toBe(before)
	})
	it('accepts a workspace-bound owner matrix', () =>
		expect(parseCrmPermissions(base, workspaceId)).toEqual(base))
	it.each([
		{ ...base, schemaVersion: 2 },
		{ ...base, role: 'MEMBER' },
		{ ...base, role: 'MANAGER' },
		{ ...base, state: 'READ_ONLY' },
		{ ...base, role: 'ANALYST' },
		{ ...base, permissions: ['customers:read', 'customers:read'] },
		{ ...base, permissions: ['unknown:permission'] },
		{ ...base, workspaceId: '22222222-2222-4222-8222-222222222222' },
		{ ...base, teamIds: ['invalid'] },
		{ ...base, token: 'unexpected' }
	])('fails closed on an incompatible or elevated matrix', value =>
		expect(parseCrmPermissions(value, workspaceId)).toBeNull()
	)
	it('accepts only aggregate access for ANALYST', () =>
		expect(
			parseCrmPermissions(
				{ ...base, role: 'ANALYST', permissions: ['sales:analytics'] },
				workspaceId
			)?.permissions
		).toEqual(['sales:analytics']))
	it('retains owner export in READ_ONLY', () =>
		expect(
			parseCrmPermissions(
				{
					...base,
					state: 'READ_ONLY',
					permissions: ['customers:read', 'customers:export']
				},
				workspaceId
			)?.state
		).toBe('READ_ONLY'))
})
