import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { getRuntimeConfig } from '@/shared/config/runtime'
import { isNonEmptyString, isUuidV4 } from '@/shared/lib/contract'
import { validBillingMutation } from '../model/billing-command.contract'
import { isBillingConfirmationUrl } from '../model/billing-redirect'
import {
	parseBillingContext,
	parseBillingHistory,
	parseBillingOperation,
	parseBillingOrderResponse
} from '../model/billing-response.contract'
import {
	billingInteger,
	parseBillingQuote,
	validBillingQuoteRequest,
	type BillingQuoteRequest
} from '../model/billing-values.contract'
import type { BillingMutation } from '../model/billing.types'

const endpoint = '/crm/access/billing'
const requireBillingUi = () => {
	if (!getRuntimeConfig().wincrmBillingEnabled)
		throw new AuthenticatedApiError(
			'temporary',
			'Оплата WinCRM скоро будет доступна'
		)
}
const validWorkspace = (workspaceId: string) => {
	requireBillingUi()
	if (!isUuidV4(workspaceId)) throw invalidContractError()
}
const requireValue = <T>(value: T | null): T => {
	if (value === null) throw invalidContractError()
	return value
}
export const getBillingContext = async (
	accessToken: string,
	workspaceId: string,
	actorSubject: string
) => {
	validWorkspace(workspaceId)
	if (!isNonEmptyString(actorSubject, 256)) throw invalidContractError()
	return requireValue(
		parseBillingContext(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: endpoint,
				params: { workspaceId }
			}),
			workspaceId,
			actorSubject,
			isBillingConfirmationUrl
		)
	)
}
export const getBillingQuote = async (
	accessToken: string,
	request: BillingQuoteRequest
) => {
	requireBillingUi()
	if (!validBillingQuoteRequest(request)) throw invalidContractError()
	return requireValue(
		parseBillingQuote(
			await authenticatedRequest({
				accessToken,
				method: 'POST',
				url: `${endpoint}/quote`,
				data: request
			}),
			request
		)
	)
}
export const mutateBilling = async (
	accessToken: string,
	mutation: BillingMutation
) => {
	requireBillingUi()
	if (!validBillingMutation(mutation)) throw invalidContractError()
	const { workspaceId, commandId } = mutation.body
	return requireValue(
		parseBillingOperation(
			await authenticatedRequest({
				accessToken,
				method: 'POST',
				url: `${endpoint}/${mutation.action}`,
				data: mutation.body,
				headers: { 'Idempotency-Key': commandId }
			}),
			workspaceId,
			commandId,
			isBillingConfirmationUrl
		)
	)
}
export const getBillingOrder = async (
	accessToken: string,
	workspaceId: string,
	orderId: string
) => {
	validWorkspace(workspaceId)
	if (!isUuidV4(orderId)) throw invalidContractError()
	return requireValue(
		parseBillingOrderResponse(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${endpoint}/orders/${orderId}`,
				params: { workspaceId }
			}),
			workspaceId,
			orderId,
			isBillingConfirmationUrl
		)
	)
}
export const getBillingHistory = async (
	accessToken: string,
	workspaceId: string,
	page: number,
	pageSize = 20
) => {
	validWorkspace(workspaceId)
	if (
		!billingInteger(page, 1, 1000000) ||
		!billingInteger(pageSize, 1, 100)
	)
		throw invalidContractError()
	return requireValue(
		parseBillingHistory(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${endpoint}/history`,
				params: {
					workspaceId,
					page: String(page),
					pageSize: String(pageSize)
				}
			}),
			workspaceId,
			page,
			pageSize,
			isBillingConfirmationUrl
		)
	)
}
export const getBillingOperation = async (
	accessToken: string,
	workspaceId: string,
	commandId: string
) => {
	validWorkspace(workspaceId)
	if (!isUuidV4(commandId)) throw invalidContractError()
	return requireValue(
		parseBillingOperation(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${endpoint}/operations/${commandId}`,
				params: { workspaceId }
			}),
			workspaceId,
			commandId,
			isBillingConfirmationUrl
		)
	)
}
export const recoverBillingOperation = async (
	accessToken: string,
	workspaceId: string,
	commandId: string
) => {
	validWorkspace(workspaceId)
	if (!isUuidV4(commandId)) throw invalidContractError()
	return requireValue(
		parseBillingOperation(
			await authenticatedRequest({
				accessToken,
				method: 'POST',
				url: `${endpoint}/operations/${commandId}/recover`,
				data: { schemaVersion: 1, workspaceId }
			}),
			workspaceId,
			commandId,
			isBillingConfirmationUrl
		)
	)
}
