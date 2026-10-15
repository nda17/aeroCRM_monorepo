import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AuthenticatedApiError,
	authenticatedRequest
} from '@/shared/api/authenticated-http-client'
import {
	applyAssignment,
	parseAssignmentPreview,
	parseAssignmentResult,
	parseDealLoss,
	parseLossReport,
	parseLossReasons,
	previewAssignment,
	listSalesTimelineV4,
	saveLossReasons,
	type ApplyAssignment,
	type AssignmentSelection,
	type LossReport
} from './sales-productivity.api'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<object>()),
		authenticatedRequest: vi.fn()
	})
)

const workspaceId = '11111111-1111-4111-8111-111111111111'
const commandId = '22222222-2222-4222-8222-222222222222'
const dealId = '33333333-3333-4333-8333-333333333333'
const secondDealId = '44444444-4444-4444-8444-444444444444'
const membershipId = '55555555-5555-4555-8555-555555555555'
const targetMembershipId = '66666666-6666-4666-8666-666666666666'
const request = vi.mocked(authenticatedRequest)
const selection: AssignmentSelection = {
	schemaVersion: 1,
	workspaceId,
	actorMembershipId: membershipId,
	assignee: { subject: 'target-user', membershipId: targetMembershipId },
	deals: [{ id: dealId, expectedVersion: 2 }]
}
const preview = {
	schemaVersion: 1,
	workspaceId,
	actorSubject: 'actor-user',
	actorMembershipId: membershipId,
	assignee: selection.assignee,
	previewHash: 'a'.repeat(64),
	deals: [
		{
			id: dealId,
			expectedVersion: 2,
			title: 'Deal',
			fromSubject: 'old-user',
			transferredTaskCount: 1,
			retainedTaskCount: 0
		}
	],
	transferredTaskCount: 1,
	retainedTaskCount: 0
}
const apply: ApplyAssignment = {
	...selection,
	commandId,
	previewHash: preview.previewHash
}
const assignmentResult = {
	schemaVersion: 1,
	workspaceId,
	commandId,
	assignee: selection.assignee,
	deals: [{ id: dealId, version: 3, transferredTaskCount: 1 }],
	transferredTaskCount: 1
}

beforeEach(() => vi.clearAllMocks())

describe('sales productivity response contracts', () => {
	it('rejects unexpected and mismatched loss settings, deal snapshots, and report totals', () => {
		const reasons = {
			schemaVersion: 1,
			workspaceId,
			version: 1,
			reasons: [{ id: dealId, title: 'Competitor', archived: false }]
		}
		expect(parseLossReasons(reasons, workspaceId)).toEqual(reasons)
		expect(
			parseLossReasons({ ...reasons, extra: true }, workspaceId)
		).toBeNull()
		expect(
			parseLossReasons({ ...reasons, workspaceId: commandId }, workspaceId)
		).toBeNull()
		const dealLoss = {
			schemaVersion: 1,
			workspaceId,
			dealId,
			dealVersion: 3,
			status: 'LOST',
			lostAt: '2026-10-15T10:00:00.000Z',
			reason: { id: commandId, title: 'Competitor' }
		}
		expect(parseDealLoss(dealLoss, workspaceId, dealId)).toEqual(dealLoss)
		expect(
			parseDealLoss(
				{ ...dealLoss, dealId: commandId },
				workspaceId,
				dealId
			)
		).toBeNull()
		expect(
			parseDealLoss({ ...dealLoss, status: 'OPEN' }, workspaceId, dealId)
		).toBeNull()
		const report: LossReport = {
			schemaVersion: 1,
			workspaceId,
			currency: 'RUB',
			population: 'CURRENT_LOST',
			period: { basis: 'LOST_AT', from: null, to: null },
			totals: { count: 1, amountMinor: 100 },
			reasons: [
				{
					reasonId: commandId,
					title: 'Competitor',
					count: 1,
					amountMinor: 100
				}
			],
			unknownDate: { count: 0, amountMinor: 0 }
		}
		expect(parseLossReport(report, workspaceId, {})).toEqual(report)
		expect(
			parseLossReport(
				{ ...report, totals: { count: 2, amountMinor: 100 } },
				workspaceId,
				{}
			)
		).toBeNull()
		expect(
			parseLossReport(
				{ ...report, workspaceId: commandId },
				workspaceId,
				{}
			)
		).toBeNull()
	})

	it('rejects previews that substitute the actor, target, deal versions, or task totals', () => {
		expect(
			parseAssignmentPreview(preview, selection, 'actor-user')
		).toEqual(preview)
		expect(
			parseAssignmentPreview(
				{ ...preview, actorSubject: 'other-actor' },
				selection,
				'actor-user'
			)
		).toBeNull()
		expect(
			parseAssignmentPreview(
				{
					...preview,
					assignee: { ...selection.assignee, subject: 'other-target' }
				},
				selection,
				'actor-user'
			)
		).toBeNull()
		expect(
			parseAssignmentPreview(
				{
					...preview,
					deals: [{ ...preview.deals[0], expectedVersion: 1 }]
				},
				selection,
				'actor-user'
			)
		).toBeNull()
		expect(
			parseAssignmentPreview(
				{ ...preview, transferredTaskCount: 2 },
				selection,
				'actor-user'
			)
		).toBeNull()
		expect(
			parseAssignmentPreview(
				{ ...preview, deals: [{ ...preview.deals[0], extra: true }] },
				selection,
				'actor-user'
			)
		).toBeNull()
	})

	it('accepts apply results only when every selected deal advances exactly one version', () => {
		expect(parseAssignmentResult(assignmentResult, apply)).toEqual(
			assignmentResult
		)
		expect(
			parseAssignmentResult(
				{
					...assignmentResult,
					deals: [{ ...assignmentResult.deals[0], version: 4 }]
				},
				apply
			)
		).toBeNull()
		expect(
			parseAssignmentResult({ ...assignmentResult, deals: [] }, apply)
		).toBeNull()
		expect(
			parseAssignmentResult(
				{ ...assignmentResult, commandId: secondDealId },
				apply
			)
		).toBeNull()
	})

	it('accepts v4 loss details only on TRANSITIONED timeline entries', async () => {
		const row = {
			id: secondDealId,
			dealId,
			kind: 'TRANSITIONED',
			actorSubject: 'actor-user',
			outcome: 'Сделка потеряна',
			fromStageId: membershipId,
			toStageId: targetMembershipId,
			createdAt: '2026-10-15T10:00:00.000Z',
			details: {
				loss: {
					lostAt: '2026-10-15T10:00:00.000Z',
					reason: { id: commandId, title: 'Competitor' }
				}
			}
		}
		request.mockResolvedValueOnce({
			schemaVersion: 4,
			page: 1,
			pageSize: 10,
			total: 1,
			items: [row]
		})
		const result = await listSalesTimelineV4(
			'token',
			workspaceId,
			dealId,
			1
		)
		expect(result.items[0]).toMatchObject({
			kind: 'TRANSITIONED',
			details: row.details
		})
		request.mockResolvedValueOnce({
			schemaVersion: 4,
			page: 1,
			pageSize: 10,
			total: 1,
			items: [
				{
					...row,
					details: {
						loss: {
							lostAt: null,
							reason: { id: commandId, title: 'Legacy reason' }
						}
					}
				}
			]
		})
		const legacy = await listSalesTimelineV4(
			'token',
			workspaceId,
			dealId,
			1
		)
		expect(legacy.items[0]).toMatchObject({
			kind: 'TRANSITIONED',
			details: {
				loss: { lostAt: null, reason: { title: 'Legacy reason' } }
			}
		})

		request.mockResolvedValueOnce({
			schemaVersion: 4,
			page: 1,
			pageSize: 10,
			total: 1,
			items: [{ ...row, kind: 'TASK_COMPLETED' }]
		})
		await expect(
			listSalesTimelineV4('token', workspaceId, dealId, 1)
		).rejects.toBeInstanceOf(AuthenticatedApiError)
	})
})

describe('sales productivity command API', () => {
	it('rejects a save receipt with stale version or reordered/non-atomic settings', async () => {
		const command = {
			schemaVersion: 1 as const,
			workspaceId,
			commandId,
			actorMembershipId: membershipId,
			expectedVersion: 4,
			reasons: [{ id: dealId, title: 'Competitor', archived: false }]
		}
		request.mockResolvedValueOnce({
			schemaVersion: 1,
			workspaceId,
			version: 6,
			reasons: command.reasons
		})
		await expect(saveLossReasons('token', command)).rejects.toBeInstanceOf(
			AuthenticatedApiError
		)
		request.mockResolvedValueOnce({
			schemaVersion: 1,
			workspaceId,
			version: 5,
			reasons: []
		})
		await expect(saveLossReasons('token', command)).rejects.toBeInstanceOf(
			AuthenticatedApiError
		)
	})

	it('replays an UNKNOWN assignment with the same immutable command and idempotency key', async () => {
		request
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Result unknown')
			)
			.mockResolvedValueOnce(assignmentResult)
		await expect(applyAssignment('token', apply)).rejects.toMatchObject({
			kind: 'temporary'
		})
		expect(await applyAssignment('token', apply)).toEqual(assignmentResult)
		expect(request).toHaveBeenCalledTimes(2)
		const first = request.mock.calls[0][0]
		const second = request.mock.calls[1][0]
		expect(first.data).toEqual(second.data)
		expect(first.headers?.['Idempotency-Key']).toBe(commandId)
		expect(second.headers?.['Idempotency-Key']).toBe(commandId)
	})

	it('rejects stale previews before posting an assignment', async () => {
		request.mockResolvedValueOnce({
			...preview,
			deals: [{ ...preview.deals[0], expectedVersion: 1 }]
		})
		await expect(
			previewAssignment('token', selection, 'actor-user')
		).rejects.toBeInstanceOf(AuthenticatedApiError)
		expect(request).toHaveBeenCalledTimes(1)
	})
})
