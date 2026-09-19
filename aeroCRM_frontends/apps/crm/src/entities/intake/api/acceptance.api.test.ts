import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	getInboxAcceptance,
	mutateInboxAcceptance
} from './acceptance.api'
import type { AcceptanceCommand } from '../model/acceptance.contract'
vi.mock('@/shared/api/authenticated-http-client', () => ({
	authenticatedRequest: vi.fn(),
	invalidContractError: () => new Error('invalid contract')
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const entryId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const date = '2026-09-05T00:00:00.000Z'
const row = {
	id: commandId,
	workspaceId,
	entryId,
	actorSubject: 'owner',
	status: 'QUEUED',
	version: 1,
	mode: 'EXECUTE',
	contactId: null,
	dealId: null,
	firstTaskId: null,
	lastErrorCode: null,
	retryAt: null,
	completedAt: null,
	createdAt: date,
	updatedAt: date
}
beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(authenticatedRequest).mockResolvedValue({
		schemaVersion: 1,
		acceptance: row
	})
})
describe('Acceptance API actor-free, versioned commands', () => {
	it('sends the exact explicitly confirmed name without normalizing a pending retry', async () => {
		const command: AcceptanceCommand = {
			operation: 'accept',
			workspaceId,
			entryId,
			commandId,
			expectedVersion: 4,
			contact: { mode: 'CREATE_FROM_ENTRY', name: 'Иван Петров' },
			deal: {
				title: 'Продажа',
				currency: 'RUB',
				amountMinor: 0,
				pipelineId: workspaceId,
				stageId: entryId,
				nextTask: { title: 'Позвонить', dueAt: date }
			}
		}
		await mutateInboxAcceptance('session', command)
		await mutateInboxAcceptance('session', command)
		const calls = vi.mocked(authenticatedRequest).mock.calls
		expect(calls[0][0].data).toMatchObject({
			commandId,
			contact: { mode: 'CREATE_FROM_ENTRY', name: 'Иван Петров' }
		})
		expect(calls[1][0].data).toEqual(calls[0][0].data)
	})
	it.each([
		{ mode: 'CREATE_FROM_ENTRY', name: null },
		{ mode: 'CREATE_FROM_ENTRY', name: '' },
		{ mode: 'CREATE_FROM_ENTRY', name: ' ' },
		{ mode: 'CREATE_FROM_ENTRY', name: ' Иван ' },
		{ mode: 'CREATE_FROM_ENTRY', name: 'x'.repeat(201) },
		{ mode: 'CREATE_FROM_ENTRY', name: 'Иван', extra: true },
		{ mode: 'EXISTING', contactId: entryId, name: 'Переименование' },
		{ mode: 'unknown' }
	])(
		'rejects invalid confirmed names or ambiguous contact choices before HTTP',
		async contact => {
			await expect(
				mutateInboxAcceptance('session', {
					operation: 'accept',
					workspaceId,
					entryId,
					commandId,
					expectedVersion: 1,
					contact
				} as AcceptanceCommand)
			).rejects.toThrow('invalid contract')
			expect(authenticatedRequest).not.toHaveBeenCalled()
		}
	)
	it('reads only the requested workspace/entry state', async () => {
		await getInboxAcceptance('session', workspaceId, entryId)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'GET',
			url: `/crm/intake/inbox/${entryId}/acceptance`,
			params: { workspaceId }
		})
	})
	it.each(['retry', 'recover'] as const)(
		'sends exact %s version and idempotency key with no actor override',
		async operation => {
			await mutateInboxAcceptance('session', {
				operation,
				workspaceId,
				entryId,
				commandId,
				expectedVersion: 7,
				actorSubject: 'attacker'
			} as AcceptanceCommand)
			expect(authenticatedRequest).toHaveBeenCalledWith({
				accessToken: 'session',
				method: 'POST',
				url: `/crm/intake/inbox/${entryId}/acceptance/${operation}`,
				headers: { 'Idempotency-Key': commandId },
				data: {
					schemaVersion: 1,
					workspaceId,
					commandId,
					expectedVersion: 7
				}
			})
		}
	)
	it.each(['EXISTING', 'CREATE_FROM_ENTRY'] as const)(
		'uses explicit %s contact selection, not copied contact PII',
		async mode => {
			const contact =
				mode === 'EXISTING' ? { mode, contactId: entryId } : { mode }
			const deal = {
				title: 'Продажа',
				currency: 'RUB' as const,
				amountMinor: 10050,
				pipelineId: workspaceId,
				stageId: entryId,
				nextTask: { title: 'Позвонить', dueAt: date }
			}
			await mutateInboxAcceptance('session', {
				operation: 'accept',
				workspaceId,
				entryId,
				commandId,
				expectedVersion: 4,
				contact,
				deal
			})
			expect(authenticatedRequest).toHaveBeenCalledWith({
				accessToken: 'session',
				method: 'POST',
				url: `/crm/intake/inbox/${entryId}/accept`,
				headers: { 'Idempotency-Key': commandId },
				data: {
					schemaVersion: 1,
					workspaceId,
					commandId,
					expectedVersion: 4,
					contact,
					deal
				}
			})
		}
	)
	it.each([
		{ entryId: '../escape' },
		{ workspaceId: 'wrong' },
		{ commandId: 'wrong' },
		{ expectedVersion: 0 }
	])('rejects invalid routing and version before HTTP', async patch => {
		await expect(
			mutateInboxAcceptance('session', {
				operation: 'retry',
				workspaceId,
				entryId,
				commandId,
				expectedVersion: 1,
				...patch
			})
		).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('does not treat a null or foreign reply as a successful command', async () => {
		for (const acceptance of [null, { ...row, workspaceId: commandId }]) {
			vi.mocked(authenticatedRequest).mockResolvedValue({
				schemaVersion: 1,
				acceptance
			})
			await expect(
				mutateInboxAcceptance('session', {
					operation: 'retry',
					workspaceId,
					entryId,
					commandId,
					expectedVersion: 1
				})
			).rejects.toThrow()
		}
	})
})
