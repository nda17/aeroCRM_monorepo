import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	getEmployeeProfile,
	updateEmployeeProfile
} from './employee-profile.api'
vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))

const request = {
	workspaceId: '11111111-1111-4111-8111-111111111111',
	subject: 'owner',
	targetSubject: 'employee'
}
const profile = { firstName: 'Иван', lastName: 'Петров', middleName: null }
const command = {
	...request,
	commandId: '33333333-3333-4333-8333-333333333333',
	expectedVersion: 0,
	profile
}
const result = {
	...request,
	schemaVersion: 1,
	profile: {
		...profile,
		id: '22222222-2222-4222-8222-222222222222',
		version: 1,
		updatedAt: '2026-09-07T10:00:00.000Z'
	}
}
beforeEach(() => vi.clearAllMocks())

describe('employee profile API', () => {
	it('sends only target identity, never caller authority, in the scoped read', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...result,
			profile: null
		})
		await expect(
			getEmployeeProfile('token', request)
		).resolves.toMatchObject({ profile: null })
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/access/team/profiles',
			params: {
				workspaceId: request.workspaceId,
				subject: request.targetSubject
			}
		})
	})
	it('uses exact UUID/CAS/profile and validates the saved version and normalized fields', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(result)
		await expect(updateEmployeeProfile('token', command)).resolves.toEqual(
			result
		)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/access/team/profiles',
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				schemaVersion: 1,
				commandId: command.commandId,
				workspaceId: request.workspaceId,
				subject: request.targetSubject,
				expectedVersion: 0,
				profile
			}
		})
	})
	it.each([
		{ ...result, profile: null },
		{ ...result, subject: 'another' },
		{ ...result, profile: { ...result.profile, version: 3 } },
		{ ...result, profile: { ...result.profile, firstName: 'Пётр' } }
	])(
		'does not accept an ambiguous or mismatched save response',
		async response => {
			vi.mocked(authenticatedRequest).mockResolvedValue(response)
			await expect(
				updateEmployeeProfile('token', command)
			).rejects.toMatchObject({ kind: 'temporary' })
		}
	)
})
