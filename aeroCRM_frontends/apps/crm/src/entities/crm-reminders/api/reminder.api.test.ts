import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { listReminderRules, mutateReminderRule } from './reminder.api'
import type {
	ReminderCommand,
	ReminderRule
} from '../model/reminder.contract'
vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
const workspaceId = '22222222-2222-4222-8222-222222222222'
const id = '11111111-1111-4111-8111-111111111111'
const rule: ReminderRule = {
	schemaVersion: 1,
	id,
	scope: 'PERSONAL',
	ownerBinding: { subject: 'owner', membershipId: null },
	title: 'Срок',
	enabled: false,
	channels: [],
	trigger: { kind: 'AT_DUE', offsetMinutes: 0 },
	repeats: null,
	timeZone: 'UTC',
	quietHours: null,
	recipients: { kind: 'SELF' }
}
const command: ReminderCommand = {
	commandId: '33333333-3333-4333-8333-333333333333',
	workspaceId,
	actor: rule.ownerBinding,
	action: 'create',
	rule
}
beforeEach(() => vi.resetAllMocks())
describe('reminder rules HTTP', () => {
	it.each([null, id])(
		'sends server pagination/archive and only exact actor membership %s',
		async membershipId => {
			vi.mocked(authenticatedRequest).mockResolvedValue({
				schemaVersion: 1,
				workspaceId,
				page: 2,
				pageSize: 10,
				total: 0,
				items: [],
				limits: { PERSONAL: 10, WORKSPACE: 20 },
				deliveryReady: false
			})
			await listReminderRules('token', {
				workspaceId,
				actor: { subject: 'owner', membershipId },
				scope: 'PERSONAL',
				archived: true,
				page: 2,
				pageSize: 10
			})
			expect(authenticatedRequest).toHaveBeenCalledWith({
				accessToken: 'token',
				method: 'GET',
				url: '/crm/sales/reminder-rules',
				params: {
					workspaceId,
					scope: 'PERSONAL',
					archived: 'true',
					page: '2',
					pageSize: '10',
					...(membershipId ? { actorMembershipId: membershipId } : {})
				}
			})
		}
	)
	it.each(['create', 'edit', 'archive'] as const)(
		'sends %s with stable command/header, CAS and no local binding metadata',
		async action => {
			vi.mocked(authenticatedRequest).mockResolvedValue({
				schemaVersion: 1,
				item: {
					workspaceId,
					rule,
					version: action === 'create' ? 1 : 3,
					archivedAt:
						action === 'archive' ? '2026-09-07T00:00:00.000Z' : null,
					createdAt: '2026-09-07T00:00:00.000Z',
					updatedAt: '2026-09-07T00:00:00.000Z'
				},
				deliveryReady: false
			})
			await mutateReminderRule('token', {
				...command,
				action,
				...(action === 'create' ? {} : { expectedVersion: 2 })
			})
			expect(authenticatedRequest).toHaveBeenCalledWith({
				accessToken: 'token',
				method: 'POST',
				url: `/crm/sales/reminder-rules${action === 'create' ? '' : `/${id}/${action}`}`,
				headers: { 'Idempotency-Key': command.commandId },
				data: {
					schemaVersion: 1,
					workspaceId,
					commandId: command.commandId,
					actorMembershipId: null,
					...(action === 'create' ? {} : { expectedVersion: 2 }),
					...(action === 'archive' ? {} : { rule })
				}
			})
		}
	)
	it('rejects unknown actor or missing CAS before transport', async () => {
		await expect(
			mutateReminderRule('token', {
				...command,
				actor: { subject: 'another', membershipId: null }
			})
		).rejects.toThrow()
		await expect(
			mutateReminderRule('token', { ...command, action: 'edit' })
		).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
})
