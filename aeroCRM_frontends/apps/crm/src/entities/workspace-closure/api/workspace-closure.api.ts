import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isNonEmptyString, isUuidV4 } from '@/shared/lib/contract'
import {
	parseClosedWorkspaceBilling,
	parseClosedWorkspaceBillingHistory,
	parseClosedWorkspaceBillingOrder,
	parseWorkspaceClosureCommand,
	parseWorkspaceClosureEnvelope,
	parseWorkspaceClosureList,
	parseWorkspaceClosurePreview
} from '../model/workspace-closure.contract'
import type { WorkspaceClosureCommand } from '../model/workspace-closure.types'

const endpoint = '/crm/access'
const validSessionBinding = (subject: string) =>
	isNonEmptyString(subject, 256)
const requireValue = <T>(value: T | null): T => {
	if (value === null) throw invalidContractError()
	return value
}

export const getWorkspaceClosurePreview = async (
	accessToken: string,
	workspaceId: string,
	expectedSubject: string
) => {
	if (!isUuidV4(workspaceId) || !validSessionBinding(expectedSubject))
		throw invalidContractError()
	return requireValue(
		parseWorkspaceClosurePreview(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${endpoint}/workspaces/${workspaceId}/closure-preview`
			}),
			workspaceId,
			expectedSubject
		)
	)
}

export const listWorkspaceClosures = async (
	accessToken: string,
	expectedSubject: string
) => {
	if (!validSessionBinding(expectedSubject)) throw invalidContractError()
	return requireValue(
		parseWorkspaceClosureList(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${endpoint}/workspace-closures`
			}),
			expectedSubject
		)
	)
}

export const getWorkspaceClosure = async (
	accessToken: string,
	closureId: string,
	expectedWorkspaceId: string,
	expectedSubject: string
) => {
	if (
		!isUuidV4(closureId) ||
		!isUuidV4(expectedWorkspaceId) ||
		!validSessionBinding(expectedSubject)
	)
		throw invalidContractError()
	return requireValue(
		parseWorkspaceClosureEnvelope(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${endpoint}/workspace-closures/${closureId}`
			}),
			expectedWorkspaceId,
			expectedSubject
		)
	)
}

export const requestWorkspaceClosure = async (
	accessToken: string,
	body: WorkspaceClosureCommand,
	expectedSubject: string
) => {
	const command = parseWorkspaceClosureCommand(body)
	if (!command || !validSessionBinding(expectedSubject))
		throw invalidContractError()
	return requireValue(
		parseWorkspaceClosureEnvelope(
			await authenticatedRequest({
				accessToken,
				method: 'POST',
				url: `${endpoint}/workspace-closures`,
				data: command,
				headers: { 'Idempotency-Key': command.commandId }
			}),
			command.workspaceId,
			expectedSubject
		)
	)
}

const closedBillingUrl = (
	closureId: string,
	workspaceId: string,
	subject: string
) => {
	if (
		!isUuidV4(closureId) ||
		!isUuidV4(workspaceId) ||
		!validSessionBinding(subject)
	)
		throw invalidContractError()
	return `${endpoint}/workspace-closures/${closureId}/billing`
}

export const getClosedWorkspaceBilling = async (
	accessToken: string,
	closureId: string,
	expectedWorkspaceId: string,
	expectedSubject: string
) => {
	const url = closedBillingUrl(
		closureId,
		expectedWorkspaceId,
		expectedSubject
	)
	return requireValue(
		parseClosedWorkspaceBilling(
			await authenticatedRequest({ accessToken, method: 'GET', url }),
			expectedWorkspaceId,
			expectedSubject
		)
	)
}

export const getClosedWorkspaceBillingHistory = async (
	accessToken: string,
	closureId: string,
	expectedWorkspaceId: string,
	expectedSubject: string,
	page: number,
	pageSize: number
) => {
	const url = closedBillingUrl(
		closureId,
		expectedWorkspaceId,
		expectedSubject
	)
	if (
		!Number.isSafeInteger(page) ||
		page < 1 ||
		page > 100000 ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1 ||
		pageSize > 100
	)
		throw invalidContractError()
	return requireValue(
		parseClosedWorkspaceBillingHistory(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${url}/history`,
				params: { page: String(page), pageSize: String(pageSize) }
			}),
			expectedWorkspaceId,
			expectedSubject,
			page,
			pageSize
		)
	)
}

export const getClosedWorkspaceBillingOrder = async (
	accessToken: string,
	closureId: string,
	expectedWorkspaceId: string,
	expectedSubject: string,
	orderId: string
) => {
	const url = closedBillingUrl(
		closureId,
		expectedWorkspaceId,
		expectedSubject
	)
	if (!isUuidV4(orderId)) throw invalidContractError()
	return requireValue(
		parseClosedWorkspaceBillingOrder(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${url}/orders/${orderId}`
			}),
			expectedWorkspaceId,
			expectedSubject,
			orderId
		)
	)
}
