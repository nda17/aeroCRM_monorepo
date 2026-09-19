import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getPublicHttpClient } from '@/shared/api/http-client'

import {
	activateCrmTrial,
	getCrmAccessBootstrap,
	getPipelineTemplates,
	installCrmTemplate
} from './crm-access.api'

vi.mock('@/shared/api/http-client', () => ({
	getPublicHttpClient: vi.fn()
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const membershipId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const resolved = {
	schemaVersion: 1,
	state: 'NOT_ACTIVATED',
	selectedWorkspaceId: workspaceId,
	membership: { membershipId, role: 'OWNER' },
	workspaces: [{ workspaceId, membershipId, role: 'OWNER' }],
	entitlementStatus: 'NOT_ACTIVATED',
	entitlement: null,
	access: null
}
const installationCommand = {
	commandId,
	workspaceId,
	templateKey: 'appointment-services',
	templateVersion: 1
}
const activeAccess = {
	...resolved,
	state: 'ACTIVE',
	entitlementStatus: 'ACTIVE',
	entitlement: {
		id: '44444444-4444-4444-8444-444444444444',
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
const installationResponse = {
	schemaVersion: 1,
	installation: {
		...installationCommand,
		pipelineId: '55555555-5555-4555-8555-555555555555',
		templateFingerprint: 'a'.repeat(64)
	},
	access: activeAccess
}

describe('crm access api', () => {
	const request = vi.fn()
	beforeEach(() => {
		request.mockReset()
		vi.mocked(getPublicHttpClient).mockReturnValue({ request } as never)
	})

	it('sends the selected workspace only as a bootstrap query parameter', async () => {
		request.mockResolvedValue({ data: resolved })
		await getCrmAccessBootstrap('token', workspaceId)
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'GET',
				url: '/crm/access/bootstrap',
				params: { workspaceId },
				headers: { Authorization: 'Bearer token' }
			})
		)
	})

	it('uses one command id in trial body and idempotency header', async () => {
		request.mockResolvedValue({
			data: {
				...resolved,
				state: 'ONBOARDING',
				entitlementStatus: 'ACTIVE',
				entitlement: {
					id: '44444444-4444-4444-8444-444444444444',
					workspaceId,
					planCode: 'TRIAL',
					seatLimit: 5,
					policyVersion: 1,
					graceUntil: '2026-09-10T00:00:00.000Z',
					trialStartedAt: '2026-09-02T00:00:00.000Z',
					effectiveFrom: '2026-09-02T00:00:00.000Z',
					effectiveUntil: '2026-09-07T00:00:00.000Z',
					aggregateVersion: '1',
					sourceSequence: '1'
				},
				access: null,
				activated: true
			}
		})
		await activateCrmTrial('token', { workspaceId, commandId })
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/crm/access/trial',
				data: { schemaVersion: 1, workspaceId, commandId },
				headers: {
					'Idempotency-Key': commandId,
					Authorization: 'Bearer token'
				}
			})
		)
	})

	it('rejects a stale templates contract', async () => {
		request.mockResolvedValue({
			data: { schemaVersion: 1, catalogVersion: 1, templates: [] }
		})
		await expect(getPipelineTemplates('token')).rejects.toMatchObject({
			kind: 'temporary'
		})
	})

	it('installs the exact template revision with one idempotency key', async () => {
		request.mockResolvedValue({ data: installationResponse })

		await expect(
			installCrmTemplate('token', installationCommand)
		).resolves.toEqual(installationResponse)
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'POST',
				url: '/crm/access/onboarding/template',
				data: { schemaVersion: 1, ...installationCommand },
				headers: {
					'Idempotency-Key': commandId,
					Authorization: 'Bearer token'
				}
			})
		)
	})

	it('rejects an installation response for a different template revision', async () => {
		request.mockResolvedValue({
			data: {
				...installationResponse,
				installation: {
					...installationResponse.installation,
					templateVersion: 2
				}
			}
		})

		await expect(
			installCrmTemplate('token', installationCommand)
		).rejects.toMatchObject({ kind: 'temporary' })
	})

	it('keeps an idempotency conflict distinct from a temporary failure', async () => {
		request.mockRejectedValue({
			isAxiosError: true,
			response: { status: 409 }
		})
		await expect(
			activateCrmTrial('token', { workspaceId, commandId })
		).rejects.toMatchObject({ kind: 'conflict' })
	})

	it('recognizes only the exact missing-template error as definitive', async () => {
		request.mockRejectedValue({
			isAxiosError: true,
			response: {
				status: 404,
				data: { code: 'crm_template_version_not_found' }
			}
		})

		await expect(
			installCrmTemplate('token', installationCommand)
		).rejects.toMatchObject({ kind: 'notFound' })
	})

	it.each([
		[403, 'forbidden'],
		[404, 'temporary']
	] as const)('keeps HTTP %s distinct as %s', async (status, kind) => {
		request.mockRejectedValue({
			isAxiosError: true,
			response: { status }
		})

		await expect(
			installCrmTemplate('token', installationCommand)
		).rejects.toMatchObject({ kind })
	})
})
