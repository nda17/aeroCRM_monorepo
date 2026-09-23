import { describe, expect, it } from 'vitest'
import {
	parseWorkspaceClosureCommand,
	parseWorkspaceClosureEnvelope,
	parseWorkspaceClosureList,
	parseWorkspaceClosurePreview,
	parseWorkspaceClosureView
} from './workspace-closure.contract'
import { WORKSPACE_CLOSURE_SERVICES } from './workspace-closure.types'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const closureId = '22222222-2222-4222-8222-222222222222'
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

describe('workspace closure wire contracts', () => {
	it('accepts the exact v1 command and rejects extras, wrong version, and malformed UUID', () => {
		const command = {
			schemaVersion: 1,
			commandId: closureId,
			workspaceId,
			expectedVersion: '0',
			confirmationLabel: 'Sales'
		}
		expect(parseWorkspaceClosureCommand(command)).toEqual(command)
		expect(
			parseWorkspaceClosureCommand({ ...command, subject: 'owner' })
		).toBeNull()
		expect(
			parseWorkspaceClosureCommand({ ...command, expectedVersion: '1' })
		).toBeNull()
		expect(
			parseWorkspaceClosureCommand({ ...command, commandId: 'bad' })
		).toBeNull()
	})

	it('requires the seven ordered exact participant steps and bounded positive versions', () => {
		expect(parseWorkspaceClosureView(view)).toEqual(view)
		expect(parseWorkspaceClosureView({ ...view, version: '0' })).toBeNull()
		expect(
			parseWorkspaceClosureView({
				...view,
				version: '99999999999999999999'
			})
		).toBeNull()
		expect(
			parseWorkspaceClosureView({ ...view, surprise: true })
		).toBeNull()
		expect(
			parseWorkspaceClosureView({
				...view,
				steps: [...view.steps].reverse()
			})
		).toBeNull()
		expect(
			parseWorkspaceClosureView({ ...view, steps: view.steps.slice(1) })
		).toBeNull()
		expect(
			parseWorkspaceClosureView({
				...view,
				requestedAt: '2026-02-30T12:00:00.000Z'
			})
		).toBeNull()
	})

	it('rejects CLOSED unless every participant has advanced and Intake is SETTLED', () => {
		const closed = {
			...view,
			state: 'CLOSED',
			closedAt: at,
			steps: WORKSPACE_CLOSURE_SERVICES.map(service => ({
				service,
				state: 'SETTLED',
				lastErrorCode: null
			}))
		}
		expect(parseWorkspaceClosureView(closed)?.state).toBe('CLOSED')
		expect(
			parseWorkspaceClosureView({ ...closed, steps: view.steps })
		).toBeNull()
		expect(
			parseWorkspaceClosureView({
				...closed,
				steps: closed.steps.map(step =>
					step.service === 'crm-intake'
						? { ...step, state: 'FENCED' }
						: step
				)
			})
		).toBeNull()
		expect(
			parseWorkspaceClosureView({ ...closed, closedAt: null })
		).toBeNull()
	})

	it('binds preview and list responses to the active subject and expected workspace', () => {
		const preview = {
			schemaVersion: 1,
			scope: { subject: 'owner-1', workspaceId },
			enabled: true,
			version: '0',
			confirmationLabel: 'Sales',
			closure: null
		}
		expect(
			parseWorkspaceClosurePreview(preview, workspaceId, 'owner-1')
		).toEqual(preview)
		expect(
			parseWorkspaceClosurePreview(
				{ ...preview, scope: { ...preview.scope, subject: 'other' } },
				workspaceId,
				'owner-1'
			)
		).toBeNull()
		expect(
			parseWorkspaceClosurePreview(
				{
					...preview,
					scope: { ...preview.scope, workspaceId: closureId }
				},
				workspaceId,
				'owner-1'
			)
		).toBeNull()
		const list = {
			schemaVersion: 1,
			scope: { subject: 'owner-1' },
			items: [view]
		}
		expect(parseWorkspaceClosureList(list, 'owner-1')).toEqual(list)
		expect(
			parseWorkspaceClosureList(
				{ ...list, scope: { subject: 'other' } },
				'owner-1'
			)
		).toBeNull()
		expect(
			parseWorkspaceClosureList(
				{ ...list, items: [view, view] },
				'owner-1'
			)
		).toBeNull()
	})

	it('unwraps only a matching closure envelope and refuses a foreign workspace', () => {
		expect(
			parseWorkspaceClosureEnvelope(
				{ schemaVersion: 1, closure: view },
				workspaceId,
				'owner-1'
			)
		).toEqual(view)
		expect(
			parseWorkspaceClosureEnvelope(
				{ schemaVersion: 1, closure: { ...view, workspaceId: closureId } },
				workspaceId,
				'owner-1'
			)
		).toBeNull()
		expect(
			parseWorkspaceClosureEnvelope(
				{ schemaVersion: 1, closure: view, actorSubject: 'owner-1' },
				workspaceId,
				'owner-1'
			)
		).toBeNull()
	})
})
