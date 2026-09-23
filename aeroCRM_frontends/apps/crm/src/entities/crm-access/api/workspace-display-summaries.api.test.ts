import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { getWorkspaceDisplaySummaries } from './workspace-display-summaries.api'

vi.mock(
	'@/shared/api/authenticated-http-client',
	async importOriginal => ({
		...(await importOriginal<
			typeof import('@/shared/api/authenticated-http-client')
		>()),
		authenticatedRequest: vi.fn()
	})
)

const subject = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const response = {
	schemaVersion: 1,
	scope: { subject },
	items: [
		{ workspaceId, membershipRole: 'OWNER', displayName: 'Компания' }
	]
}

beforeEach(() => vi.resetAllMocks())

describe('getWorkspaceDisplaySummaries', () => {
	it('requests and parses the subject-bound display contract', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(response)

		expect(await getWorkspaceDisplaySummaries('token', subject)).toEqual(
			response
		)
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'GET',
			url: '/crm/access/workspaces/display-summaries'
		})
	})

	it('rejects a foreign subject', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...response,
			scope: { subject: '33333333-3333-4333-8333-333333333333' }
		})

		await expect(
			getWorkspaceDisplaySummaries('token', subject)
		).rejects.toThrow(invalidContractError())
	})

	it.each([
		{
			...response,
			items: [response.items[0], response.items[0]]
		},
		{
			...response,
			items: [{ ...response.items[0], displayName: '😀'.repeat(41) }]
		},
		{
			...response,
			items: [{ ...response.items[0], membershipRole: 'ADMIN' }]
		},
		{
			...response,
			extra: true
		}
	])('rejects malformed summaries', async malformed => {
		vi.mocked(authenticatedRequest).mockResolvedValue(malformed)

		await expect(
			getWorkspaceDisplaySummaries('token', subject)
		).rejects.toThrow(invalidContractError())
	})
})
