import {
	hasExactKeys,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import {
	billingCycle,
	billingEntityVersion,
	billingSeats,
	billingVersion
} from './billing-values.contract'
import type { BillingMutation } from './billing.types'

export const validBillingMutation = (
	value: unknown
): value is BillingMutation => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['action', 'body']) ||
		!isRecord(value.body)
	)
		return false
	const body = value.body
	const common = [
		'schemaVersion',
		'workspaceId',
		'commandId',
		'expectedBillingVersion'
	]
	if (
		body.schemaVersion !== 1 ||
		!isUuidV4(body.workspaceId) ||
		!isUuidV4(body.commandId) ||
		!billingVersion(body.expectedBillingVersion)
	)
		return false
	if (value.action === 'orders/verify')
		return (
			hasExactKeys(body, [...common, 'orderId', 'expectedOrderVersion']) &&
			isUuidV4(body.orderId) &&
			billingEntityVersion(body.expectedOrderVersion)
		)
	if (value.action === 'checkout')
		return (
			hasExactKeys(body, [
				...common,
				'expectedPolicyVersion',
				'cycle',
				'totalSeats',
				'autoRenew',
				'consentVersion'
			]) &&
			billingEntityVersion(body.expectedPolicyVersion) &&
			billingCycle(body.cycle) &&
			billingSeats(body.totalSeats) &&
			((body.autoRenew === true &&
				isNonEmptyString(body.consentVersion, 128)) ||
				(body.autoRenew === false && body.consentVersion === null))
		)
	if (value.action === 'seats')
		return (
			hasExactKeys(body, [
				...common,
				'expectedPeriodId',
				'expectedPeriodVersion',
				'newTotalSeats'
			]) &&
			isUuidV4(body.expectedPeriodId) &&
			billingEntityVersion(body.expectedPeriodVersion) &&
			billingSeats(body.newTotalSeats)
		)
	if (value.action === 'renewal/disable')
		return (
			hasExactKeys(body, [...common, 'expectedRenewalVersion']) &&
			billingEntityVersion(body.expectedRenewalVersion)
		)
	if (value.action === 'renewal/confirm-price')
		return (
			hasExactKeys(body, [
				...common,
				'expectedRenewalVersion',
				'expectedPolicyVersion',
				'consentVersion'
			]) &&
			billingEntityVersion(body.expectedRenewalVersion) &&
			billingEntityVersion(body.expectedPolicyVersion) &&
			isNonEmptyString(body.consentVersion, 128)
		)
	return false
}
