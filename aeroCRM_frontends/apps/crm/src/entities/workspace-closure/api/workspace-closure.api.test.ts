import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { WORKSPACE_CLOSURE_SERVICES } from '../model/workspace-closure.types'
import {
	getWorkspaceClosure,
	getWorkspaceClosurePreview,
	requestWorkspaceClosure
} from './workspace-closure.api'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<
			typeof import('@/shared/api/authenticated-http-client')
		>()),
		authenticatedRequest: vi.fn()
	})
)

const closureId = '22222222-2222-4222-8222-222222222222'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const at = '2026-09-23T12:00:00.000Z'
const view = {
	id: closureId,
	workspaceId,
	displayName: 'Sales',
	state: 'CLOSING',
	version: '1',
	requestedAt: at,
	closedAt: null,
	steps: WORKSPACE_CLOSURE_SERVICES.map(service => ({
		service,
		state: 'PENDING',
		lastErrorCode: null
	})),
	financialPendingCount: 0,
	priorDispatchCount: 0,
	lastErrorCode: null
}

describe('workspace closure API', () => {
	beforeEach(() => vi.clearAllMocks())

	it('binds closure reads to the caller workspace and unwraps the service envelope', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			closure: view
		})
		await expect(
			getWorkspaceClosure('token', closureId, workspaceId, 'owner-1')
		).resolves.toEqual(view)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: `/crm/access/workspace-closures/${closureId}`
		})
	})

	it('sends a matching idempotency key and exact command body', async () => {
		const command = {
			schemaVersion: 1 as const,
			commandId: closureId,
			workspaceId,
			expectedVersion: '0' as const,
			confirmationLabel: 'Sales'
		}
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			closure: view
		})
		await expect(
			requestWorkspaceClosure('token', command, 'owner-1')
		).resolves.toEqual(view)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/access/workspace-closures',
			data: command,
			headers: { 'Idempotency-Key': closureId }
		})
	})

	it('rejects malformed inputs and foreign workspace/subject replies', async () => {
		await expect(
			getWorkspaceClosurePreview('token', '../foreign', 'owner-1')
		).rejects.toThrow()
		await expect(
			requestWorkspaceClosure(
				'token',
				{
					schemaVersion: 1,
					commandId: closureId,
					workspaceId,
					expectedVersion: '1' as '0',
					confirmationLabel: 'Sales'
				},
				'owner-1'
			)
		).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()

		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			scope: { subject: 'another-user', workspaceId },
			enabled: true,
			version: '0',
			confirmationLabel: 'Sales',
			closure: null
		})
		await expect(
			getWorkspaceClosurePreview('token', workspaceId, 'owner-1')
		).rejects.toThrow()

		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			closure: { ...view, workspaceId: closureId }
		})
		await expect(
			getWorkspaceClosure('token', closureId, workspaceId, 'owner-1')
		).rejects.toThrow()
	})
})
