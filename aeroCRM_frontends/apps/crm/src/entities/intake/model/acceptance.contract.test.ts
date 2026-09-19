import { describe, expect, it } from 'vitest'
import {
	acceptanceStatuses,
	parseAcceptanceResponse
} from './acceptance.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const entryId = '22222222-2222-4222-8222-222222222222'
const id = '33333333-3333-4333-8333-333333333333'
const date = '2026-09-05T00:00:00.000Z'
const acceptance = {
	id,
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
const parse = (row: unknown) =>
	parseAcceptanceResponse(
		{ schemaVersion: 1, acceptance: row },
		workspaceId,
		entryId
	)
describe('Intake acceptance exact proof summary', () => {
	it('distinguishes a confirmed absence from invalid/missing responses', () => {
		expect(parse(null)).toEqual({ schemaVersion: 1, acceptance: null })
		expect(parse(undefined)).toBeNull()
		expect(
			parseAcceptanceResponse({ schemaVersion: 1 }, workspaceId, entryId)
		).toBeNull()
	})
	it.each(acceptanceStatuses)(
		'accepts canonical %s state without inventing completion',
		status => {
			const terminal = status === 'CANCELLED' || status === 'COMPLETED'
			const row = {
				...acceptance,
				status,
				completedAt: terminal ? date : null,
				...(status === 'COMPLETED'
					? { contactId: id, dealId: entryId, firstTaskId: workspaceId }
					: {})
			}
			expect(parse(row)?.acceptance).toEqual(row)
		}
	)
	it('retains the already committed contact on cancelled and blocked workflows', () => {
		expect(
			parse({
				...acceptance,
				status: 'CANCELLED',
				contactId: id,
				completedAt: date
			})?.acceptance?.contactId
		).toBe(id)
		expect(
			parse({
				...acceptance,
				status: 'BLOCKED',
				contactId: id,
				lastErrorCode: 'WORKFLOW_ACCESS_BLOCKED'
			})
		).not.toBeNull()
	})
	it.each([
		{ workspaceId: id },
		{ entryId: id },
		{ actorSubject: '' },
		{ version: 0 },
		{ version: 2147483648 },
		{ version: 1.5 },
		{ status: 'DONE' },
		{ mode: 'DELETE' },
		{ completedAt: date },
		{ status: 'COMPLETED', completedAt: date },
		{ status: 'CANCELLED' },
		{ contactId: '../escape' },
		{ dealId: id },
		{ dealId: id, firstTaskId: entryId },
		{ retryAt: '2026-09-05' },
		{ lastErrorCode: 'private-error' },
		{ accessToken: 'unexpected' },
		{ contactName: 'unexpected' },
		{ createdAt: 'yesterday' }
	])('rejects malformed, cross-scope or leaking metadata: %j', patch =>
		expect(parse({ ...acceptance, ...patch })).toBeNull()
	)
	it('rejects envelope extensions and incompatible versions', () => {
		for (const value of [
			{ schemaVersion: 2, acceptance },
			{ schemaVersion: 1, acceptance, debug: {} }
		])
			expect(
				parseAcceptanceResponse(value, workspaceId, entryId)
			).toBeNull()
	})
})
