import {
	AuthenticatedApiError,
	authenticatedRequest
} from '@/shared/api/authenticated-http-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createManagedPipeline,
	createDealQuote,
	getCommerceAnalytics,
	getDealCommerce,
	listCatalogItems,
	listCommerceHistory,
	replaceDealLines,
	saveCatalogItem,
	updateCatalogItem
} from './commerce.api'

vi.mock('@/shared/api/authenticated-http-client', async () => ({
	...(await vi.importActual<
		typeof import('@/shared/api/authenticated-http-client')
	>('@/shared/api/authenticated-http-client')),
	authenticatedRequest: vi.fn()
}))
const request = vi.mocked(authenticatedRequest)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const dealId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const pipelineId = '88888888-8888-4888-8888-888888888888'
const stageIds = [
	'44444444-4444-4444-8444-444444444444',
	'55555555-5555-4555-8555-555555555555',
	'66666666-6666-4666-8666-666666666666'
]

describe('commerce API boundaries', () => {
	beforeEach(() => vi.clearAllMocks())
	it('sends schema, workspace and matching idempotency key for commerce commands', async () => {
		const pipeline = {
			id: dealId,
			workspaceId,
			name: 'Продажи',
			version: 1,
			templateKey: 'custom',
			templateVersion: 1,
			stages: stageIds.map((id, index) => ({
				id,
				key: ['new', 'won', 'lost'][index],
				name: ['Новая', 'Успешно', 'Отказ'][index],
				position: index + 1,
				state: ['OPEN', 'WON', 'LOST'][index]
			}))
		}
		request.mockResolvedValue({ schemaVersion: 1, pipeline })
		await expect(
			createManagedPipeline('token', workspaceId, {
				commandId,
				name: ' Продажи '
			})
		).resolves.toEqual(pipeline)
		expect(request).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'token',
			method: 'POST',
			url: '/crm/sales/commerce/pipelines',
			headers: { 'Idempotency-Key': commandId },
			data: { schemaVersion: 1, workspaceId, commandId, name: 'Продажи' },
			mapError: expect.any(Function)
		})
	})
	it('sends explicit null catalog prices and accepts zero in strict item response', async () => {
		const date = '2026-09-05T10:00:00.000Z'
		const item = {
			id: dealId,
			workspaceId,
			code: 'C-1',
			kind: 'PRODUCT',
			name: 'Чай',
			unit: 'шт.',
			basePriceMinor: null,
			version: 1,
			archivedAt: null,
			createdAt: date,
			updatedAt: date
		}
		request.mockResolvedValue({ schemaVersion: 1, item })
		await expect(
			saveCatalogItem('token', workspaceId, {
				commandId,
				kind: 'PRODUCT',
				name: 'Чай',
				unit: 'шт.',
				basePriceMinor: null
			})
		).resolves.toEqual(item)
		expect(request.mock.calls[0][0]).toMatchObject({
			headers: { 'Idempotency-Key': commandId },
			data: {
				schemaVersion: 1,
				workspaceId,
				commandId,
				basePriceMinor: null
			}
		})
	})
	it('forwards an optional catalog kind change and checks the updated response', async () => {
		const date = '2026-09-05T10:00:00.000Z'
		request.mockResolvedValue({
			schemaVersion: 1,
			item: {
				id: dealId,
				workspaceId,
				code: 'C-1',
				kind: 'SERVICE',
				name: 'Кабель монтажный',
				unit: 'шт.',
				basePriceMinor: 100,
				version: 2,
				archivedAt: null,
				createdAt: date,
				updatedAt: date
			}
		})
		await expect(
			updateCatalogItem('token', workspaceId, dealId, {
				commandId,
				expectedVersion: 1,
				kind: 'SERVICE',
				name: 'Кабель монтажный',
				unit: 'шт.',
				basePriceMinor: 100
			})
		).resolves.toMatchObject({ kind: 'SERVICE', version: 2 })
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					kind: 'SERVICE',
					expectedVersion: 1
				})
			})
		)
	})
	it('rejects a mismatched deal binding and does not leak an unchecked response', async () => {
		request.mockResolvedValue({
			schemaVersion: 1,
			dealId: workspaceId,
			dealVersion: 1,
			mode: 'MANUAL',
			amountMinor: 0,
			items: []
		})
		await expect(
			getDealCommerce('token', workspaceId, dealId)
		).rejects.toMatchObject({ kind: 'temporary' })
	})
	it('classifies invalid replace-line input before HTTP and keeps response mismatches uncertain', async () => {
		const invalidInput = {
			commandId,
			expectedVersion: 1,
			lines: [
				{
					kind: 'PRODUCT' as const,
					name: 'Кабель',
					unit: 'м',
					quantity: '1.5',
					unitPriceMinor: 100,
					discountMinor: 0
				}
			]
		}

		const invalidError = await replaceDealLines(
			'token',
			workspaceId,
			dealId,
			invalidInput
		).catch(error => error)
		expect(invalidError).toBeInstanceOf(AuthenticatedApiError)
		expect(invalidError).toMatchObject({ kind: 'validation' })
		expect(request).not.toHaveBeenCalled()

		request.mockResolvedValue({})
		await expect(
			replaceDealLines('token', workspaceId, dealId, {
				...invalidInput,
				lines: [{ ...invalidInput.lines[0], quantity: '1.500' }]
			})
		).rejects.toMatchObject({ kind: 'temporary' })
		expect(request).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ method: 'POST' })
		)
	})
	it('accepts the quote response wrapper and keeps malformed responses uncertain', async () => {
		const quote = {
			id: '99999999-9999-4999-8999-999999999999',
			dealId,
			version: 1,
			snapshot: {
				schemaVersion: 1,
				quoteVersion: 1,
				dealVersion: 2,
				dealId,
				sellerName: 'Seller',
				sellerDetails: '',
				customerName: 'Customer',
				customerDetails: '',
				dealTitle: 'Install',
				currency: 'RUB',
				amountMinor: 500,
				lines: [
					{
						id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
						kind: 'SERVICE',
						name: 'Монтаж',
						unit: 'час',
						quantity: '1.000',
						unitPriceMinor: 500,
						discountMinor: 0,
						totalMinor: 500
					}
				]
			},
			createdBySubject: 'seller-subject',
			createdAt: '2026-09-23T00:00:00.000Z'
		}
		const command = {
			commandId,
			sellerName: 'Seller'
		}

		request.mockResolvedValueOnce({ schemaVersion: 1, quote })
		await expect(
			createDealQuote('token', workspaceId, dealId, command)
		).resolves.toMatchObject({ id: quote.id, snapshot: quote.snapshot })

		request.mockResolvedValueOnce(quote)
		await expect(
			createDealQuote('token', workspaceId, dealId, command)
		).rejects.toMatchObject({ kind: 'temporary' })
		expect(request).toHaveBeenCalledTimes(2)
	})
	it('validates list arguments before issuing HTTP', async () => {
		await expect(
			listCatalogItems('token', workspaceId, { page: 1, pageSize: 101 })
		).rejects.toMatchObject({ kind: 'validation' })
		expect(request).not.toHaveBeenCalled()
	})
	it('sends the analytics pipeline filter and rejects malformed filter values before HTTP', async () => {
		const from = '2026-09-01T00:00:00.000Z'
		const to = '2026-09-30T00:00:00.000Z'
		request.mockResolvedValue({
			schemaVersion: 1,
			currency: 'RUB',
			from,
			to,
			pipelineId,
			dealValueMinor: '100',
			receiptsMinor: '80',
			refundsMinor: '10',
			netPaidMinor: '70'
		})
		await expect(
			getCommerceAnalytics('token', workspaceId, { from, to, pipelineId })
		).resolves.toMatchObject({ pipelineId, netPaidMinor: '70' })
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				params: { workspaceId, from, to, pipelineId }
			})
		)
		await expect(
			getCommerceAnalytics('token', workspaceId, {
				from,
				to,
				pipelineId: 'invalid'
			})
		).rejects.toMatchObject({ kind: 'validation' })
		expect(request).toHaveBeenCalledTimes(1)
	})
	it('returns deal-bound history events using the current API signature', async () => {
		const event = {
			id: '77777777-7777-4777-8777-777777777777',
			kind: 'PAYMENT_ADDED',
			dealId,
			actorSubject: 'actor',
			details: {},
			createdAt: '2026-09-05T10:00:00.000Z'
		}
		request.mockResolvedValue({ schemaVersion: 1, items: [event] })
		await expect(
			listCommerceHistory('token', workspaceId, dealId)
		).resolves.toEqual([event])
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ params: { workspaceId, dealId } })
		)
	})
})
