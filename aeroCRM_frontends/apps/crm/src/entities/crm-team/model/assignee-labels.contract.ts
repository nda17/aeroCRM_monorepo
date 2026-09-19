import { hasExactKeys, isRecord, isUuidV4 } from '@/shared/lib/contract'
import {
	isAssigneeSubject,
	isScopedAssigneeOption,
	type AssigneeBinding,
	type AssigneeOption
} from './assignee-options.contract'

export interface AssigneeLabelsRequest {
	workspaceId: string
	subject: string
	dataScope: 'ALL' | 'TEAM' | 'OWN'
	bindings: readonly AssigneeBinding[]
}
export interface AssigneeLabels {
	schemaVersion: 1
	workspaceId: string
	subject: string
	items: { binding: AssigneeBinding; employee: AssigneeOption | null }[]
}
export const assigneeBindingKey = (binding: AssigneeBinding) =>
	JSON.stringify([binding.subject, binding.membershipId])
const validBinding = (value: unknown): value is AssigneeBinding =>
	isRecord(value) &&
	hasExactKeys(value, ['subject', 'membershipId']) &&
	isAssigneeSubject(value.subject) &&
	(value.membershipId === null || isUuidV4(value.membershipId))

export const validAssigneeLabelsRequest = (
	request: AssigneeLabelsRequest
) =>
	isUuidV4(request.workspaceId) &&
	isAssigneeSubject(request.subject) &&
	['ALL', 'TEAM', 'OWN'].includes(request.dataScope) &&
	Array.isArray(request.bindings) &&
	request.bindings.length > 0 &&
	request.bindings.length <= 100 &&
	request.bindings.every(validBinding) &&
	new Set(request.bindings.map(assigneeBindingKey)).size ===
		request.bindings.length

export const parseAssigneeLabels = (
	value: unknown,
	request: AssigneeLabelsRequest
): AssigneeLabels | null => {
	if (
		!validAssigneeLabelsRequest(request) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'subject',
			'items'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== request.workspaceId ||
		value.subject !== request.subject ||
		!Array.isArray(value.items) ||
		value.items.length !== request.bindings.length
	)
		return null
	const requested = new Set(request.bindings.map(assigneeBindingKey))
	const received = new Set<string>()
	const employees = new Map<string, AssigneeOption>()
	const memberships = new Map<string, string>()
	const owners = new Set<string>()
	for (const row of value.items) {
		if (
			!isRecord(row) ||
			!hasExactKeys(row, ['binding', 'employee']) ||
			!validBinding(row.binding)
		)
			return null
		const key = assigneeBindingKey(row.binding)
		if (!requested.has(key) || received.has(key)) return null
		received.add(key)
		if (
			row.employee !== null &&
			(!isScopedAssigneeOption(row.employee, request) ||
				row.employee.subject !== row.binding.subject ||
				(row.binding.membershipId !== null &&
					row.employee.membershipId !== row.binding.membershipId))
		)
			return null
		if (row.employee !== null) {
			const employee = row.employee as AssigneeOption
			const previous = employees.get(employee.subject)
			if (
				previous &&
				(Object.keys(previous) as (keyof AssigneeOption)[]).some(
					field => previous[field] !== employee[field]
				)
			)
				return null
			const subject = memberships.get(employee.membershipId)
			if (subject !== undefined && subject !== employee.subject)
				return null
			employees.set(employee.subject, employee)
			memberships.set(employee.membershipId, employee.subject)
			if (employee.role === 'OWNER') owners.add(employee.subject)
			if (owners.size > 1) return null
		}
	}
	return value as unknown as AssigneeLabels
}
