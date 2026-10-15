export type CrmRefundReviewStatus = 'PENDING' | 'REVIEWED'
export type CrmRefundVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'FAILED'

export interface CrmRefundView {
	schemaVersion: 1
	id: string
	version: number
	shopId: string
	providerMode: 'LIVE' | 'TEST'
	providerRefundId: string
	providerPaymentId: string | null
	orderId: string | null
	workspaceId: string | null
	verificationStatus: CrmRefundVerificationStatus
	reviewStatus: CrmRefundReviewStatus
	amountMinor: string | null
	currency: 'RUB' | null
	providerCreatedAt: string | null
	verifiedAt: string | null
	attempts: number
	lastErrorCode: string | null
	reviewedAt: string | null
	reviewedBy: string | null
	reviewComment: string | null
	createdAt: string
	updatedAt: string
}

export interface CrmRefundPage {
	schemaVersion: 1
	page: number
	limit: number
	total: number
	items: CrmRefundView[]
}

export interface CrmRefundCommand {
	schemaVersion: 1
	commandId: string
	expectedVersion: number
	comment?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REVIEW = new Set<CrmRefundReviewStatus>(['PENDING', 'REVIEWED'])
const VERIFICATION = new Set<CrmRefundVerificationStatus>(['PENDING', 'VERIFIED', 'REJECTED', 'FAILED'])

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) =>
	Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const nullableText = (value: unknown, max = 256): value is string | null =>
	value === null || (typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value))
const nullableMultilineText = (value: unknown, max = 256): value is string | null =>
	value === null || (typeof value === 'string' && value.length <= max && !/[\x00-\x09\x0b-\x1f\x7f]/.test(value))
const date = (value: unknown): value is string => {
	if (typeof value !== 'string' || value.length !== 24) return false
	const parsed = new Date(value)
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

export function parseCrmRefundView(value: unknown, expectedId?: string): CrmRefundView {
	const keys = ['schemaVersion', 'id', 'version', 'shopId', 'providerMode', 'providerRefundId', 'providerPaymentId', 'orderId', 'workspaceId', 'verificationStatus', 'reviewStatus', 'amountMinor', 'currency', 'providerCreatedAt', 'verifiedAt', 'attempts', 'lastErrorCode', 'reviewedAt', 'reviewedBy', 'reviewComment', 'createdAt', 'updatedAt']
	if (
		!record(value) || !exact(value, keys) || value.schemaVersion !== 1 ||
		typeof value.id !== 'string' || !UUID.test(value.id) || (expectedId !== undefined && value.id !== expectedId) ||
		!Number.isSafeInteger(value.version) || Number(value.version) < 1 || Number(value.version) > 2_147_483_646 ||
		typeof value.shopId !== 'string' || value.shopId.length < 1 || value.shopId.length > 64 || /[\s\x00-\x1f\x7f]/.test(value.shopId) ||
		(value.providerMode !== 'LIVE' && value.providerMode !== 'TEST') ||
		typeof value.providerRefundId !== 'string' || !UUID.test(value.providerRefundId) ||
		!(value.providerPaymentId === null || (typeof value.providerPaymentId === 'string' && UUID.test(value.providerPaymentId))) ||
		!(value.orderId === null || (typeof value.orderId === 'string' && UUID.test(value.orderId))) ||
		!(value.workspaceId === null || (typeof value.workspaceId === 'string' && UUID.test(value.workspaceId))) ||
		typeof value.verificationStatus !== 'string' || !VERIFICATION.has(value.verificationStatus as CrmRefundVerificationStatus) ||
		typeof value.reviewStatus !== 'string' || !REVIEW.has(value.reviewStatus as CrmRefundReviewStatus) ||
		!(value.amountMinor === null || (typeof value.amountMinor === 'string' && /^(0|[1-9][0-9]{0,12})$/.test(value.amountMinor) && (value.amountMinor.length < 13 || value.amountMinor <= '1000000000000'))) ||
		!(value.currency === null || value.currency === 'RUB') ||
		!(value.providerCreatedAt === null || date(value.providerCreatedAt)) ||
		!(value.verifiedAt === null || date(value.verifiedAt)) ||
		!Number.isInteger(value.attempts) || Number(value.attempts) < 0 || Number(value.attempts) > 10 ||
		!nullableText(value.lastErrorCode, 128) || !(value.reviewedAt === null || date(value.reviewedAt)) ||
		!nullableText(value.reviewedBy, 256) || !nullableMultilineText(value.reviewComment, 2_000) ||
		!date(value.createdAt) || !date(value.updatedAt)
	) throw new Error('Invalid CRM refund')
	if (value.verificationStatus === 'VERIFIED' &&
		(value.providerPaymentId === null || value.orderId === null || value.workspaceId === null ||
			value.amountMinor === null || value.currency !== 'RUB' || value.providerCreatedAt === null || value.verifiedAt === null))
		throw new Error('Verified CRM refund is missing provider evidence')
	if (value.reviewStatus === 'REVIEWED' &&
		(value.verificationStatus !== 'VERIFIED' || value.reviewedAt === null || value.reviewedBy === null ||
			value.reviewComment === null || value.reviewComment.trim().length === 0))
		throw new Error('Reviewed CRM refund is missing its decision')
	return value as unknown as CrmRefundView
}

export function parseCrmRefundPage(value: unknown, page: number, limit: number): CrmRefundPage {
	if (!record(value) || !exact(value, ['schemaVersion', 'page', 'limit', 'total', 'items']) || value.schemaVersion !== 1 ||
		value.page !== page || value.limit !== limit || !Number.isSafeInteger(value.total) || Number(value.total) < 0 ||
		!Array.isArray(value.items) || value.items.length > limit || value.items.length > Number(value.total)) throw new Error('Invalid CRM refund page')
	const items = value.items.map(item => parseCrmRefundView(item))
	if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate CRM refunds')
	return value as unknown as CrmRefundPage
}

export function validCrmRefundCommand(value: unknown, kind: 'review' | 'retry'): value is CrmRefundCommand {
	if (!record(value) || value.schemaVersion !== 1 || typeof value.commandId !== 'string' || !UUID4.test(value.commandId) ||
		!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 1 || Number(value.expectedVersion) > 2_147_483_645) return false
	const keys = kind === 'review' ? ['schemaVersion', 'commandId', 'expectedVersion', 'comment'] : ['schemaVersion', 'commandId', 'expectedVersion']
	if (!exact(value, keys)) return false
	if (kind === 'retry') return true
	return typeof value.comment === 'string' && value.comment.trim().length > 0 && value.comment.trim().length <= 2_000 && !/[\x00-\x09\x0B-\x1f\x7f]/.test(value.comment)
}
