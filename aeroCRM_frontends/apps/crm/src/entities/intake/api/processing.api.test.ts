import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	getMailIntakeProcessing,
	listInboxProcessing
} from './processing.api'

vi.mock('@/shared/api/authenticated-http-client', () => ({
	authenticatedRequest: vi.fn(),
	invalidContractError: () => new Error('invalid contract')
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const entryId = '22222222-2222-4222-8222-222222222222'
const messageId = '33333333-3333-4333-8333-333333333333'
const date = '2026-10-12T00:00:00.000Z'

beforeEach(() => vi.clearAllMocks())

describe('shared intake processing APIs', () => {
	it('requests bounded shared processing and binds every result to requested IDs', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			items: [
				{
					entryId,
					acceptance: {
						actorSubject: 'staff-7',
						status: 'RUNNING',
						claimedAt: date
					}
				}
			]
		})
		await expect(
			listInboxProcessing('session', workspaceId, [entryId])
		).resolves.toMatchObject({ items: [{ entryId }] })
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'GET',
			url: '/crm/intake/inbox/processing',
			params: { workspaceId, entryIds: entryId, view: 'shared' }
		})
	})
	it.each([
		{ workspaceId: '44444444-4444-4444-8444-444444444444' },
		{ items: [] },
		{
			items: [
				{
					entryId: '44444444-4444-4444-8444-444444444444',
					acceptance: null
				}
			]
		},
		{
			items: [
				{
					entryId,
					acceptance: {
						actorSubject: 'staff',
						status: 'UNKNOWN',
						claimedAt: date
					}
				}
			]
		}
	])(
		'rejects unbound or malformed processing response %j',
		async override => {
			vi.mocked(authenticatedRequest).mockResolvedValue({
				schemaVersion: 1,
				workspaceId,
				items: [{ entryId, acceptance: null }],
				...override
			})
			await expect(
				listInboxProcessing('session', workspaceId, [entryId])
			).rejects.toThrow('invalid contract')
		}
	)
	it('rejects duplicate and oversized batches before sending a request', async () => {
		await expect(
			listInboxProcessing('session', workspaceId, [entryId, entryId])
		).rejects.toThrow('invalid contract')
		await expect(
			listInboxProcessing(
				'session',
				workspaceId,
				Array.from(
					{ length: 101 },
					(_, index) =>
						`${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`
				)
			)
		).rejects.toThrow('invalid contract')
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
	it('returns safe mail-copy facts while withholding private entry IDs', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			messageId,
			copy: {
				entryId: null,
				canOpen: false,
				actorSubject: 'staff-9',
				createdAt: date,
				acceptance: null
			}
		})
		await expect(
			getMailIntakeProcessing('session', workspaceId, messageId)
		).resolves.toMatchObject({ copy: { entryId: null, canOpen: false } })
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'GET',
			url: `/crm/intake/mail/messages/${messageId}/processing`,
			params: { workspaceId }
		})
	})
})
