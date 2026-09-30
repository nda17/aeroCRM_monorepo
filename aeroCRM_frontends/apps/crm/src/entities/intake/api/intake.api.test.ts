import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import {
	listInbox,
	getInboxEntrySource,
	mutateInbox,
	mutateIntakeSource,
	readInboxNotificationForEntry
} from './intake.api'

vi.mock('@/shared/api/authenticated-http-client', () => ({
	authenticatedRequest: vi.fn(),
	invalidContractError: () => new Error('invalid contract')
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const date = '2026-09-05T00:00:00.000Z'
const entry = {
	id,
	workspaceId,
	title: 'Тема',
	name: 'Клиент',
	phone: null,
	email: null,
	message: null,
	origin: 'MANUAL',
	sourceId: null,
	status: 'NEW',
	createdBySubject: 'owner',
	teamId: null,
	version: 1,
	contactId: null,
	dealId: null,
	rejectionReason: null,
	receivedAt: date,
	updatedAt: date,
	acceptedAt: null,
	rejectedAt: null
}
const source = {
	id,
	workspaceId,
	name: 'Форма',
	kind: 'API',
	tokenVersion: 2,
	createdBySubject: 'owner',
	teamId: null,
	version: 2,
	revokedAt: null,
	createdAt: date,
	updatedAt: date
}
beforeEach(() => vi.clearAllMocks())
describe('Intake API requests', () => {
	it('reads only the exact source metadata contract for an inbox entry', async () => {
		const sourceId = '44444444-4444-4444-8444-444444444444'
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			entryId: id,
			source: { id: sourceId, name: 'Форма сайта', kind: 'API' }
		})
		await expect(
			getInboxEntrySource('session', workspaceId, id)
		).resolves.toEqual({ id: sourceId, name: 'Форма сайта', kind: 'API' })
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'GET',
			url: `/crm/intake/inbox/${id}/source`,
			params: { workspaceId }
		})
	})
	it.each([
		{ extra: true },
		{ workspaceId: '22222222-2222-4222-8222-222222222222' },
		{ entryId: '33333333-3333-4333-8333-333333333333' },
		{
			source: {
				id: '44444444-4444-4444-8444-444444444444',
				name: 'Форма',
				kind: 'API',
				token: 'secret'
			}
		},
		{
			source: {
				id: '44444444-4444-4444-8444-444444444444',
				name: ' ',
				kind: 'API'
			}
		},
		{
			source: {
				id: '44444444-4444-4444-8444-444444444444',
				name: 'Форма',
				kind: 'CSV'
			}
		}
	])('rejects malformed source response fields %j', async override => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			entryId: id,
			source: {
				id: '44444444-4444-4444-8444-444444444444',
				name: 'Форма',
				kind: 'API'
			},
			...override
		})
		await expect(
			getInboxEntrySource('session', workspaceId, id)
		).rejects.toThrow('invalid contract')
	})
	it('sends entry-read command and accepts only the exact versioned response', async () => {
		const notificationId = '44444444-4444-4444-8444-444444444444'
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			entryId: id,
			notificationId,
			readAt: date
		})
		await readInboxNotificationForEntry('session', workspaceId, id)
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'PUT',
			url: `/crm/intake/notifications/entries/${id}/read`,
			data: { schemaVersion: 1, workspaceId }
		})
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			entryId: id,
			notificationId: null,
			readAt: null
		})
		await expect(
			readInboxNotificationForEntry('session', workspaceId, id)
		).resolves.toMatchObject({ notificationId: null, readAt: null })
	})
	it.each([
		{ extra: true },
		{ schemaVersion: 2 },
		{ workspaceId: '22222222-2222-4222-8222-222222222222' },
		{ entryId: '33333333-3333-4333-8333-333333333333' },
		{ notificationId: null, readAt: date },
		{ notificationId: 'bad-id' },
		{ readAt: 'bad-date' },
		{ readAt: '2026-09-05T00:00:00Z' }
	])('rejects invalid entry-read response fields %j', async override => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			entryId: id,
			notificationId: '44444444-4444-4444-8444-444444444444',
			readAt: date,
			...override
		})
		await expect(
			readInboxNotificationForEntry('session', workspaceId, id)
		).rejects.toThrow('invalid contract')
	})
	it('uses server-side search, status and page scoped to the workspace', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			items: [],
			total: 0,
			page: 2,
			pageSize: 25
		})
		await listInbox('session', workspaceId, 2, 25, 'Клиент', 'REJECTED')
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'GET',
			url: '/crm/intake/inbox',
			params: {
				workspaceId,
				page: '2',
				pageSize: '25',
				search: 'Клиент',
				status: 'REJECTED'
			}
		})
	})
	it('sends the frozen command UUID in header/body and never invents source/actor/outcome fields', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			entry
		})
		await mutateInbox('session', {
			operation: 'create',
			workspaceId,
			commandId,
			title: 'Тема',
			name: 'Клиент',
			phone: null,
			email: null,
			message: null,
			teamId: null
		})
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'POST',
			url: '/crm/intake/inbox',
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				title: 'Тема',
				name: 'Клиент',
				phone: null,
				email: null,
				message: null,
				teamId: null
			}
		})
	})
	it('rotation token is only a JSON command field, never part of URL or response', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			schemaVersion: 1,
			source
		})
		const token = Buffer.alloc(32, 7).toString('base64url')
		const result = await mutateIntakeSource('session', {
			operation: 'rotate',
			workspaceId,
			commandId,
			id,
			expectedVersion: 1,
			token
		})
		expect(authenticatedRequest).toHaveBeenCalledWith({
			accessToken: 'session',
			method: 'POST',
			url: `/crm/intake/sources/${id}/rotate-token`,
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				expectedVersion: 1,
				token
			}
		})
		expect(result).not.toHaveProperty('token')
	})
	it('refuses malformed IDs before any mutation request', async () => {
		await expect(
			mutateIntakeSource('session', {
				operation: 'revoke',
				workspaceId,
				commandId,
				id: '../other',
				expectedVersion: 1
			})
		).rejects.toThrow()
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
})
