import { describe, expect, it } from 'vitest'

import { parseCrmTemplateInstallationResponse } from './crm-template-installation.parser'
import type { InstallCrmTemplateCommand } from './crm-template-installation.types'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const membershipId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const pipelineId = '44444444-4444-4444-8444-444444444444'
const command: InstallCrmTemplateCommand = {
	commandId,
	workspaceId,
	templateKey: 'appointment-services',
	templateVersion: 1
}
const activeAccess = {
	schemaVersion: 1,
	state: 'ACTIVE',
	selectedWorkspaceId: workspaceId,
	membership: { membershipId, role: 'OWNER' },
	workspaces: [{ workspaceId, membershipId, role: 'OWNER' }],
	entitlementStatus: 'ACTIVE',
	entitlement: {
		id: '55555555-5555-4555-8555-555555555555',
		workspaceId,
		planCode: 'TRIAL',
		seatLimit: 5,
		policyVersion: 1,
		graceUntil: '2026-09-12T00:00:00.000Z',
		trialStartedAt: '2026-09-04T00:00:00.000Z',
		effectiveFrom: '2026-09-04T00:00:00.000Z',
		effectiveUntil: '2026-09-09T00:00:00.000Z',
		aggregateVersion: '1',
		sourceSequence: '1'
	},
	access: { lifecycle: 'ACTIVE' }
}
const response = {
	schemaVersion: 1,
	installation: {
		commandId,
		workspaceId,
		pipelineId,
		templateKey: 'appointment-services',
		templateVersion: 1,
		templateFingerprint: 'a'.repeat(64)
	},
	access: activeAccess
}

describe('parseCrmTemplateInstallationResponse', () => {
	it('accepts an exact installation result with full active access', () => {
		expect(
			parseCrmTemplateInstallationResponse(response, command)
		).toEqual(response)
	})

	it('accepts installation completed during GRACE', () => {
		const graceResponse = {
			...response,
			access: {
				...activeAccess,
				state: 'GRACE',
				entitlementStatus: 'GRACE'
			}
		}
		expect(
			parseCrmTemplateInstallationResponse(graceResponse, command)
		).toEqual(graceResponse)
	})

	it.each([
		['commandId', '66666666-6666-4666-8666-666666666666'],
		['workspaceId', '77777777-7777-4777-8777-777777777777'],
		['templateKey', 'retail-orders'],
		['templateVersion', 2]
	] as const)('rejects a mismatched installation %s', (field, value) => {
		expect(
			parseCrmTemplateInstallationResponse(
				{
					...response,
					installation: { ...response.installation, [field]: value }
				},
				command
			)
		).toBeNull()
	})

	it('rejects a non-canonical fingerprint and unexpected response keys', () => {
		expect(
			parseCrmTemplateInstallationResponse(
				{
					...response,
					installation: {
						...response.installation,
						templateFingerprint: 'A'.repeat(64)
					}
				},
				command
			)
		).toBeNull()
		expect(
			parseCrmTemplateInstallationResponse(
				{ ...response, replayed: false },
				command
			)
		).toBeNull()
	})

	it('rejects a template version outside the PostgreSQL SMALLINT contract', () => {
		expect(
			parseCrmTemplateInstallationResponse(
				{
					...response,
					installation: {
						...response.installation,
						templateVersion: 32768
					}
				},
				{ ...command, templateVersion: 32768 }
			)
		).toBeNull()
	})

	it('rejects a response that does not confirm active access', () => {
		expect(
			parseCrmTemplateInstallationResponse(
				{
					...response,
					access: {
						...activeAccess,
						state: 'ONBOARDING',
						access: null
					}
				},
				command
			)
		).toBeNull()
	})
})
