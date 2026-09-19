import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	authenticatedRequest,
	AuthenticatedApiError
} from '@/shared/api/authenticated-http-client'
import {
	getSalesAnalytics,
	getSalesAnalyticsOverview
} from './sales-analytics.api'

vi.mock('@/shared/api/authenticated-http-client', async () => ({
	...(await vi.importActual<
		typeof import('@/shared/api/authenticated-http-client')
	>('@/shared/api/authenticated-http-client')),
	authenticatedRequest: vi.fn()
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const response = {
	schemaVersion: 1,
	currency: 'RUB',
	items: ['OPEN', 'WON', 'LOST'].map(status => ({
		status,
		count: 0,
		amountMinor: 0
	}))
}

describe('Sales analytics API', () => {
	beforeEach(() => vi.clearAllMocks())
	it('requests only the scoped aggregate endpoint, never deal/contact lists', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue(response)
		await expect(
			getSalesAnalytics('test-session', workspaceId)
		).resolves.toEqual(response)
		expect(authenticatedRequest).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'test-session',
			method: 'GET',
			url: '/crm/sales/analytics',
			params: { workspaceId }
		})
	})
	it('does not turn service failures into zero metrics', async () => {
		vi.mocked(authenticatedRequest).mockRejectedValue(
			new AuthenticatedApiError('forbidden', 'Denied')
		)
		await expect(
			getSalesAnalytics('test-session', workspaceId)
		).rejects.toMatchObject({ kind: 'forbidden' })
	})
	it('rejects an invalid successful HTTP response', async () => {
		vi.mocked(authenticatedRequest).mockResolvedValue({
			...response,
			items: []
		})
		await expect(
			getSalesAnalytics('test-session', workspaceId)
		).rejects.toMatchObject({ kind: 'temporary' })
	})
})

describe('Expanded analytics request', () => {
	it('explicitly opts in and binds the returned period/page to the request', async () => {
		const report = {
			...response,
			overview: {
				dateBasis: 'CREATED_AT',
				period: null,
				previous: null,
				asOf: '2026-09-14T09:00:00.000Z',
				attention: { open: 0, overdue: 0, withoutNextAction: 0 },
				assignees: null
			}
		}
		vi.mocked(authenticatedRequest).mockResolvedValue(report)
		await expect(
			getSalesAnalyticsOverview('session', workspaceId)
		).resolves.toEqual(report)
		expect(authenticatedRequest).toHaveBeenLastCalledWith({
			accessToken: 'session',
			method: 'GET',
			url: '/crm/sales/analytics',
			params: { workspaceId, details: 'true', assigneePage: '1' }
		})
	})
	it('rejects incomplete bounds before making a request', async () => {
		vi.clearAllMocks()
		await expect(
			getSalesAnalyticsOverview('session', workspaceId, {
				createdFrom: '2026-09-01T00:00:00.000Z'
			})
		).rejects.toMatchObject({ kind: 'temporary' })
		expect(authenticatedRequest).not.toHaveBeenCalled()
	})
})
