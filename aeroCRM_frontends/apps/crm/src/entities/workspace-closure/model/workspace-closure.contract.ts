import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import {
	parseBillingHistory,
	parseBillingOrderResponse,
	parseBillingSummary
} from '@/entities/crm-billing/model/billing-response.contract'
import { isBillingConfirmationUrl } from '@/entities/crm-billing/model/billing-redirect'
import type {
	ClosedWorkspaceBilling,
	ClosedWorkspaceBillingHistory,
	ClosedWorkspaceBillingOrder,
	WorkspaceClosureCommand,
	WorkspaceClosureList,
	WorkspaceClosurePreview,
	WorkspaceClosureView
} from './workspace-closure.types'
import { WORKSPACE_CLOSURE_SERVICES } from './workspace-closure.types'

const isCount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const boundedCode = (value: unknown) =>
	value === null ||
	(typeof value === 'string' &&
		value.length > 0 &&
		value.length <= 80 &&
		!/[\x00-\x1f\x7f]/.test(value))
const boundedLabel = (value: unknown) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= 200 &&
	!/[\x00-\x1f\x7f]/.test(value)

export const parseWorkspaceClosureCommand = (
	value: unknown
): WorkspaceClosureCommand | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'commandId',
			'workspaceId',
			'expectedVersion',
			'confirmationLabel'
		]) ||
		value.schemaVersion !== 1 ||
		!isUuidV4(value.commandId) ||
		!isUuidV4(value.workspaceId) ||
		value.expectedVersion !== '0' ||
		!boundedLabel(value.confirmationLabel)
	)
		return null
	return value as unknown as WorkspaceClosureCommand
}

export const parseWorkspaceClosureView = (
	value: unknown
): WorkspaceClosureView | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'displayName',
			'state',
			'version',
			'requestedAt',
			'closedAt',
			'steps',
			'financialPendingCount',
			'priorDispatchCount',
			'lastErrorCode'
		]) ||
		!isUuidV4(value.id) ||
		!isUuidV4(value.workspaceId) ||
		!(
			value.displayName === null ||
			(typeof value.displayName === 'string' &&
				value.displayName.length > 0 &&
				value.displayName.length <= 200 &&
				!/[\x00-\x1f\x7f]/.test(value.displayName))
		) ||
		(value.state !== 'CLOSING' && value.state !== 'CLOSED') ||
		typeof value.version !== 'string' ||
		value.version.length > 19 ||
		!/^[1-9][0-9]*$/.test(value.version) ||
		!isIsoDate(value.requestedAt) ||
		!(value.closedAt === null || isIsoDate(value.closedAt)) ||
		(value.state === 'CLOSED') !== (value.closedAt !== null) ||
		!Array.isArray(value.steps) ||
		value.steps.length !== WORKSPACE_CLOSURE_SERVICES.length ||
		!isCount(value.financialPendingCount) ||
		!isCount(value.priorDispatchCount) ||
		!boundedCode(value.lastErrorCode)
	)
		return null
	const steps: WorkspaceClosureView['steps'] = []
	for (const [index, raw] of value.steps.entries()) {
		if (
			!isRecord(raw) ||
			!hasExactKeys(raw, ['service', 'state', 'lastErrorCode']) ||
			raw.service !== WORKSPACE_CLOSURE_SERVICES[index] ||
			(raw.state !== 'PENDING' &&
				raw.state !== 'FENCED' &&
				raw.state !== 'SETTLED') ||
			!boundedCode(raw.lastErrorCode)
		)
			return null
		steps.push({
			service:
				raw.service as WorkspaceClosureView['steps'][number]['service'],
			state: raw.state,
			lastErrorCode: raw.lastErrorCode as string | null
		})
	}
	if (
		value.state === 'CLOSED' &&
		(steps.some(step => step.state === 'PENDING') ||
			steps.find(step => step.service === 'crm-intake')?.state !==
				'SETTLED')
	)
		return null
	return value as unknown as WorkspaceClosureView
}

export const parseWorkspaceClosurePreview = (
	value: unknown,
	workspaceId: string,
	subject: string
): WorkspaceClosurePreview | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isNonEmptyString(subject, 256) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'scope',
			'enabled',
			'version',
			'confirmationLabel',
			'closure'
		]) ||
		value.schemaVersion !== 1 ||
		typeof value.enabled !== 'boolean' ||
		value.version !== '0' ||
		!boundedLabel(value.confirmationLabel) ||
		!isRecord(value.scope) ||
		!hasExactKeys(value.scope, ['subject', 'workspaceId']) ||
		value.scope.subject !== subject ||
		value.scope.workspaceId !== workspaceId
	)
		return null
	const closure =
		value.closure === null
			? null
			: parseWorkspaceClosureView(value.closure)
	if (
		value.closure !== null &&
		(!closure || closure.workspaceId !== workspaceId)
	)
		return null
	if (value.enabled && closure !== null) return null
	return value as unknown as WorkspaceClosurePreview
}

export const parseWorkspaceClosureList = (
	value: unknown,
	subject: string
): WorkspaceClosureList | null => {
	if (
		!isNonEmptyString(subject, 256) ||
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'scope', 'items']) ||
		value.schemaVersion !== 1 ||
		!isRecord(value.scope) ||
		!hasExactKeys(value.scope, ['subject']) ||
		value.scope.subject !== subject ||
		!Array.isArray(value.items) ||
		value.items.length > 100
	)
		return null
	const items = value.items.map(parseWorkspaceClosureView)
	if (
		items.some(item => item === null) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	return value as unknown as WorkspaceClosureList
}

export const parseWorkspaceClosureEnvelope = (
	value: unknown,
	workspaceId: string,
	subject: string
): WorkspaceClosureView | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isNonEmptyString(subject, 256) ||
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'closure']) ||
		value.schemaVersion !== 1
	)
		return null
	const closure = parseWorkspaceClosureView(value.closure)
	return closure?.workspaceId === workspaceId ? closure : null
}

export const parseClosedWorkspaceBilling = (
	value: unknown,
	workspaceId: string,
	subject: string
): ClosedWorkspaceBilling | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isNonEmptyString(subject, 256) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'actorSubject',
			'billing'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		value.actorSubject !== subject
	)
		return null
	return parseBillingSummary(
		value.billing,
		workspaceId,
		isBillingConfirmationUrl
	)
}

export const parseClosedWorkspaceBillingHistory = (
	value: unknown,
	workspaceId: string,
	subject: string,
	page: number,
	pageSize: number
): ClosedWorkspaceBillingHistory | null =>
	isNonEmptyString(subject, 256)
		? parseBillingHistory(
				value,
				workspaceId,
				page,
				pageSize,
				isBillingConfirmationUrl
			)
		: null

export const parseClosedWorkspaceBillingOrder = (
	value: unknown,
	workspaceId: string,
	subject: string,
	orderId: string
): ClosedWorkspaceBillingOrder | null =>
	isNonEmptyString(subject, 256)
		? parseBillingOrderResponse(
				value,
				workspaceId,
				orderId,
				isBillingConfirmationUrl
			)
		: null
