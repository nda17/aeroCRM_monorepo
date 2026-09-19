import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { getSlaRule, listInboxSla, saveSlaRule } from './sla.api'
import {
	parseInboxSla,
	parseSlaConfig,
	parseSlaRule,
	type SlaCommand
} from '../model/sla.contract'

vi.mock('@/shared/api/authenticated-http-client', async original => ({
	...(await original<object>()),
	authenticatedRequest: vi.fn()
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const entryId = '22222222-2222-4222-8222-222222222222'
const command: SlaCommand = {
	schemaVersion: 1,
	workspaceId,
	commandId: '33333333-3333-4333-8333-333333333333',
	expectedVersion: 0,
	config: {
		enabled: true,
		workingMinutes: 30,
		timeZone: 'Europe/Moscow',
		weekdays: [1, 2, 3, 4, 5],
		workStart: '09:00',
		workEnd: '18:00',
		responsibleBinding: { subject: 'owner', membershipId: null },
		notifyManagers: false,
		channels: ['EMAIL']
	}
}
const response = {
	schemaVersion: 1,
	workspaceId,
	rule: {
		version: 1,
		config: command.config,
		effectiveAt: '2026-09-08T09:00:00.000Z'
	},
	deliveryEnabled: false
}
beforeEach(() => vi.resetAllMocks())
describe('SLA contracts and transport', () => {
	it('loads the scoped rule without implying delivery activation', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(response)
		expect(await getSlaRule('token', workspaceId)).toEqual(response)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/intake/sla/rule',
			params: { workspaceId }
		})
	})
	it('uses the same command id and CAS version on retry', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(response)
		await saveSlaRule('token', command)
		await saveSlaRule('token', command)
		for (const [request] of vi.mocked(authenticatedRequest).mock.calls)
			expect(request).toEqual({
				accessToken: 'token',
				method: 'POST',
				url: '/crm/intake/sla/rule',
				data: command,
				headers: { 'Idempotency-Key': command.commandId }
			})
	})
	it('rejects missing CAS and an unexpected response version', async () => {
		await expect(
			saveSlaRule('token', { ...command, expectedVersion: -1 })
		).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...response,
			rule: { ...response.rule, version: 8 }
		})
		await expect(saveSlaRule('token', command)).rejects.toThrow()
	})
	it('validates the saved config while accepting server-sorted collections', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(response)
		await expect(
			saveSlaRule('token', {
				...command,
				config: { ...command.config, weekdays: [5, 4, 3, 2, 1] }
			})
		).resolves.toEqual(response)
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...response,
			rule: {
				...response.rule,
				config: { ...command.config, workingMinutes: 45 }
			}
		})
		await expect(saveSlaRule('token', command)).rejects.toThrow()
	})
	it('requests only visible page ids and accepts a visibility-filtered subset', async () => {
		const result = {
			schemaVersion: 1,
			workspaceId,
			items: [],
			deliveryEnabled: false
		}
		vi.mocked(authenticatedRequest).mockResolvedValue(result)
		expect(await listInboxSla('token', workspaceId, [entryId])).toEqual(
			result
		)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/intake/sla/inbox-status',
			params: { workspaceId, entryIds: entryId }
		})
	})
	it.each([
		{ ids: [] },
		{ ids: [entryId, entryId] },
		{ ids: Array.from({ length: 101 }, () => entryId) },
		{ ids: ['invalid'] }
	])('rejects invalid inbox ids before transport: %j', async ({ ids }) => {
		await expect(listInboxSla('token', workspaceId, ids)).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it.each([
		{ weekdays: [] },
		{ weekdays: [1, 1] },
		{ weekdays: [0] },
		{ workEnd: '09:29' },
		{ workStart: '18:00', workEnd: '09:00' },
		{ workingMinutes: 1441 },
		{ timeZone: '+03:00' },
		{ channels: [] },
		{ channels: ['SMS'] },
		{ channels: ['EMAIL', 'EMAIL'] },
		{ responsibleBinding: null, notifyManagers: false },
		{ responsibleBinding: { subject: 'raw subject', membershipId: null } }
	])('rejects invalid schedule/binding %j', patch => {
		expect(parseSlaConfig({ ...command.config, ...patch })).toBeNull()
	})
	it('rejects cross-workspace/unknown envelopes and accepts an unconfigured rule', () => {
		expect(parseSlaRule(response, entryId)).toBeNull()
		expect(
			parseSlaRule({ ...response, ready: true }, workspaceId)
		).toBeNull()
		expect(
			parseSlaRule({ ...response, rule: null }, workspaceId)
		).not.toBeNull()
	})
	it('does not accept invented, duplicate or deadline-less tracked statuses', () => {
		const item = {
			entryId,
			state: 'PENDING',
			dueAt: '2026-09-08T09:30:00.000Z'
		}
		const result = {
			schemaVersion: 1,
			workspaceId,
			items: [item],
			deliveryEnabled: true
		}
		expect(parseInboxSla(result, workspaceId, [entryId])).not.toBeNull()
		for (const items of [
			[{ ...item, entryId: workspaceId }],
			[item, item],
			[{ ...item, dueAt: null }],
			[{ ...item, state: 'ACCEPTED' }]
		])
			expect(
				parseInboxSla({ ...result, items }, workspaceId, [entryId])
			).toBeNull()
	})
})
