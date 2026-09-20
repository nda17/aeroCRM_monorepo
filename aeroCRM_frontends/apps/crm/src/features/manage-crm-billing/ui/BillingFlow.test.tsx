import type {
	BillingContext,
	BillingOperation,
	BillingRoute
} from '@/entities/crm-billing'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBillingCommand } from '../model/use-billing-command'
import { useBillingContext } from '../model/use-billing-context'
import { BillingFlow } from './BillingFlow'

vi.mock('../model/use-billing-context', () => ({
	useBillingContext: vi.fn()
}))
vi.mock('../model/use-billing-command', () => ({
	useBillingCommand: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		loading: vi.fn(),
		dismiss: vi.fn(),
		error: vi.fn()
	})
}))
vi.mock('./BillingComposer', () => ({
	BillingComposer: () => <div>Billing composer</div>
}))
vi.mock('./BillingHistoryPanel', () => ({
	BillingHistoryPanel: () => <div>Billing history</div>
}))
vi.mock('./BillingOrderPanel', () => ({
	BillingOrderPanel: () => <div>Billing order</div>
}))

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const commandId = '0f1e2d3c-4b5a-4678-89ab-cdef01234567'
const otherPendingId = '12345678-90ab-4cde-8fab-0123456789ab'
const orderId = 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62'

let pendingOperationId: string | null
let terminalOperation: BillingOperation | null
const onReference = vi.fn()

const context = (): ReturnType<typeof useBillingContext> =>
	({
		ready: true,
		actor: { workspaceId, online: true, current: () => true },
		query: {
			data: {
				schemaVersion: 1,
				workspaceId,
				actorSubject: 'owner',
				billing: {
					schemaVersion: 1,
					workspaceId,
					billingVersion: '0',
					serverTime: '2026-09-05T12:00:00.000Z',
					policy: {
						policyVersion: 2,
						monthlyPriceMinor: 129900,
						yearlyPriceMinor: 1200000,
						additionalSeatMonthlyPriceMinor: 20000,
						additionalSeatYearlyPriceMinor: 200000,
						includedSeats: 2,
						graceDays: 3
					},
					trial: null,
					period: null,
					pendingOrder: null,
					renewal: {
						version: 1,
						state: 'NONE',
						canDisable: false,
						dispatchPending: false,
						nextChargeAt: null,
						nextRetryAt: null,
						retryAttempt: 0,
						methodLast4: null,
						methodTitle: null
					}
				},
				capacity: {
					usedSeats: 1,
					admissionCeiling: null,
					pendingOperationId
				},
				capabilities: {
					quote: false,
					checkout: false,
					changeSeats: false,
					disableAutoRenew: false,
					confirmRenewalPrice: false
				}
			} as BillingContext,
			isPending: false,
			isFetching: false,
			isError: false,
			error: null,
			refetch: vi.fn()
		},
		refreshRelated: vi.fn()
	}) as unknown as ReturnType<typeof useBillingContext>

const operation = (
	state: BillingOperation['state']
): BillingOperation => ({
	schemaVersion: 1,
	workspaceId,
	commandId,
	state,
	requestHash: null,
	billing:
		state === 'COMMITTED' ? ({ order: { id: orderId } } as never) : null
})

const route: BillingRoute = { workspaceId, orderId: null, commandId }

beforeEach(() => {
	vi.clearAllMocks()
	pendingOperationId = commandId
	terminalOperation = null
	vi.mocked(useBillingContext).mockImplementation(context)
	vi.mocked(useBillingCommand).mockImplementation(
		(_context, _onReference, onConfirmed) =>
			({
				snapshot: { commandId: null, mutation: null },
				uncertain: false,
				locked: false,
				running: false,
				error: null,
				execute: vi.fn(),
				submit: vi.fn(),
				recover: vi.fn(),
				recoverReference: vi.fn(async () => {
					if (terminalOperation && terminalOperation.state !== 'PENDING')
						onConfirmed(terminalOperation)
				})
			}) as never
	)
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

const renderFlow = () =>
	render(<BillingFlow route={route} onReference={onReference} />)

describe('billing terminal proof and recovery reference', () => {
	it('removes the visible recovery prompt only after terminal proof for the same ID', async () => {
		terminalOperation = operation('CANCELLED')
		renderFlow()
		expect(
			screen.getByRole('region', { name: 'Восстановление операции' })
		).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', { name: 'Восстановить результат' })
		)
		await waitFor(() =>
			expect(
				screen.queryByRole('region', { name: 'Восстановление операции' })
			).toBeNull()
		)
		expect(onReference).toHaveBeenCalledWith(undefined)
	})

	it('keeps recovery blocked when a different pending operation remains', async () => {
		pendingOperationId = otherPendingId
		terminalOperation = operation('CANCELLED')
		renderFlow()
		fireEvent.click(
			screen.getByRole('button', { name: 'Восстановить результат' })
		)
		await waitFor(() =>
			expect(
				screen.getByRole('region', { name: 'Восстановление операции' })
			).toBeTruthy()
		)
		expect(onReference).toHaveBeenCalledWith(undefined)
	})

	it('keeps recovery blocked while the proof is still PENDING', async () => {
		terminalOperation = operation('PENDING')
		renderFlow()
		fireEvent.click(
			screen.getByRole('button', { name: 'Восстановить результат' })
		)
		await waitFor(() =>
			expect(
				screen.getByRole('region', { name: 'Восстановление операции' })
			).toBeTruthy()
		)
		expect(onReference).not.toHaveBeenCalled()
	})

	it('preserves the committed operation order reference', async () => {
		terminalOperation = operation('COMMITTED')
		renderFlow()
		fireEvent.click(
			screen.getByRole('button', { name: 'Восстановить результат' })
		)
		await waitFor(() =>
			expect(onReference).toHaveBeenCalledExactlyOnceWith({ orderId })
		)
		expect(
			screen.queryByRole('region', { name: 'Восстановление операции' })
		).toBeNull()
	})
})
