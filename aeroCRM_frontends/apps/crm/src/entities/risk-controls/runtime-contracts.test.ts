import { describe, expect, it } from 'vitest'
import {
	MARKETING_EMAIL_CONSENT_TEXT,
	MARKETING_EMAIL_CONSENT_TEXT_VERSION,
	parseMarketingEmailCommand,
	parseMarketingEmailView
} from '../../../../../packages/web/src/features/marketing-email/model/marketing-email.contract'
import {
	parseCrmRefundPage,
	parseCrmRefundView,
	validCrmRefundCommand
} from '../../../../../packages/web/src/features/admin-crm/model/crm-refunds.contract'

const emailBinding = 'a'.repeat(64)
const marketingProfile = {
	schemaVersion: 1,
	version: 2,
	enabled: true,
	email: 'user@example.com',
	emailVerified: true,
	emailBinding,
	consentTextVersion: MARKETING_EMAIL_CONSENT_TEXT_VERSION,
	consentedAt: '2026-10-15T08:30:00.000Z',
	updatedAt: '2026-10-15T08:30:00.000Z'
}

const refundId = '11111111-1111-4111-8111-111111111111'
const refund = {
	schemaVersion: 1,
	id: refundId,
	version: 2,
	shopId: 'shop-123',
	providerMode: 'TEST',
	providerRefundId: '22222222-2222-4222-8222-222222222222',
	providerPaymentId: '33333333-3333-4333-8333-333333333333',
	orderId: '44444444-4444-4444-8444-444444444444',
	workspaceId: '55555555-5555-4555-8555-555555555555',
	verificationStatus: 'VERIFIED',
	reviewStatus: 'PENDING',
	amountMinor: '12500',
	currency: 'RUB',
	providerCreatedAt: '2026-10-15T08:30:00.000Z',
	verifiedAt: '2026-10-15T08:31:00.000Z',
	attempts: 1,
	lastErrorCode: null,
	reviewedAt: null,
	reviewedBy: null,
	reviewComment: null,
	createdAt: '2026-10-15T08:29:00.000Z',
	updatedAt: '2026-10-15T08:31:00.000Z'
} as const

describe('marketing email runtime contract', () => {
	it('parses exact profile and nullable unverified state', () => {
		expect(parseMarketingEmailView(marketingProfile)).toEqual(marketingProfile)
		expect(parseMarketingEmailView({ ...marketingProfile, enabled: false, emailVerified: false, emailBinding: null, email: null, consentedAt: null, version: 0 }).version).toBe(0)
	})

	it('rejects inconsistent, malformed, or extended profiles', () => {
		for (const invalid of [
			{ ...marketingProfile, enabled: true, emailVerified: false },
			{ ...marketingProfile, emailBinding: 'bad' },
			{ ...marketingProfile, updatedAt: '2026-02-30T08:30:00.000Z' },
			{ ...marketingProfile, consentTextVersion: 'marketing-email-v2' },
			{ ...marketingProfile, unexpected: true }
		]) expect(() => parseMarketingEmailView(invalid)).toThrow()
	})

	it('accepts exact commands and rejects stale shape or unsafe fields', () => {
		const command = {
			schemaVersion: 1,
			commandId: '11111111-1111-4111-8111-111111111111',
			expectedVersion: 0,
			expectedEmailBinding: null,
			enabled: true,
			consentTextVersion: MARKETING_EMAIL_CONSENT_TEXT_VERSION
		}
		expect(parseMarketingEmailCommand(command)).toEqual(command)
		for (const invalid of [
			{ ...command, commandId: 'bad' },
			{ ...command, expectedVersion: 2_147_483_647 },
			{ ...command, expectedEmailBinding: 'bad' },
			{ ...command, enabled: 1 },
			{ ...command, consentTextVersion: 'marketing-email-v2' },
			{ ...command, extra: true }
		]) expect(() => parseMarketingEmailCommand(invalid)).toThrow()
	})
})

describe('CRM refund runtime contract', () => {
	it('parses detail with ID binding and a paginated list', () => {
		expect(parseCrmRefundView(refund, refundId)).toEqual(refund)
		expect(parseCrmRefundPage({ schemaVersion: 1, page: 1, limit: 20, total: 1, items: [refund] }, 1, 20).items).toHaveLength(1)
	})

	it('rejects unexpected identity, status, amount, time, fields, and duplicate list rows', () => {
		for (const invalid of [
			{ ...refund, version: 0 },
			{ ...refund, verificationStatus: 'QUEUED' },
			{ ...refund, amountMinor: '1000000000001' },
			{ ...refund, workspaceId: null },
			{ ...refund, createdAt: '2026-02-30T08:29:00.000Z' },
			{ ...refund, unexpected: true }
		]) expect(() => parseCrmRefundView(invalid)).toThrow()
		expect(() => parseCrmRefundView(refund, '55555555-5555-4555-8555-555555555555')).toThrow()
		expect(() => parseCrmRefundPage({ schemaVersion: 1, page: 1, limit: 20, total: 2, items: [refund, refund] }, 1, 20)).toThrow()
	})

	it('enforces review versus retry command shape and bounded review text', () => {
		const command = { schemaVersion: 1, commandId: '66666666-6666-4666-8666-666666666666', expectedVersion: 2 }
		expect(validCrmRefundCommand(command, 'retry')).toBe(true)
		expect(validCrmRefundCommand({ ...command, comment: 'duplicate' }, 'retry')).toBe(false)
		expect(validCrmRefundCommand({ ...command, comment: 'Confirmed\nby finance' }, 'review')).toBe(true)
		for (const comment of [' ', 'tab\tforbidden', 'x'.repeat(2_001)])
			expect(validCrmRefundCommand({ ...command, comment }, 'review')).toBe(false)
	})
})
