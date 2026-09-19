import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	getWorkspaceBranding,
	updateWorkspaceBranding
} from './branding.api'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
const request = {
	workspaceId: '11111111-1111-4111-8111-111111111111',
	subject: 'owner'
}
const command = {
	...request,
	commandId: '22222222-2222-4222-8222-222222222222',
	displayName: '  Север  ',
	expectedVersion: 0
}
const result = {
	schemaVersion: 1,
	...request,
	commandId: command.commandId,
	branding: {
		displayName: 'Север',
		version: 1,
		updatedAt: '2026-09-07T10:00:00.000Z'
	}
}
beforeEach(() => vi.clearAllMocks())
describe('workspace branding transport', () => {
	it('reads only requested workspace with a captured token', async () => {
		const read = {
			schemaVersion: 1,
			...request,
			branding: result.branding
		}
		vi.mocked(authenticatedRequest).mockResolvedValue(read)
		await expect(
			getWorkspaceBranding('captured', request)
		).resolves.toEqual(read)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'captured',
			method: 'GET',
			url: '/crm/access/workspace/branding',
			params: { workspaceId: request.workspaceId }
		})
	})
	it('writes normalized text with CAS, actor and idempotency binding', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(result)
		await expect(
			updateWorkspaceBranding('captured', command)
		).resolves.toEqual(result)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'captured',
			method: 'POST',
			url: '/crm/access/workspace/branding',
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				schemaVersion: 1,
				workspaceId: request.workspaceId,
				commandId: command.commandId,
				expectedActorSubject: 'owner',
				expectedVersion: 0,
				displayName: 'Север'
			}
		})
	})
	it.each([
		{ subject: 'another' },
		{ branding: { ...result.branding, version: 2 } },
		{ branding: { ...result.branding, displayName: 'Другой' } }
	])(
		'does not report a foreign or mismatched result as success %#',
		async patch => {
			vi.mocked(authenticatedRequest).mockResolvedValue({
				...result,
				...patch
			})
			await expect(
				updateWorkspaceBranding('captured', command)
			).rejects.toMatchObject({ kind: 'temporary' })
		}
	)
	it('rejects invalid text before dispatch', async () => {
		await expect(
			updateWorkspaceBranding('captured', {
				...command,
				displayName: 'x'.repeat(41)
			})
		).rejects.toMatchObject({ kind: 'validation' })
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
})
