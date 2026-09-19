import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	parseReminderPage,
	parseReminderResult,
	parseReminderRule,
	sameReminderBinding,
	validReminderBinding,
	validReminderPageRequest,
	type ReminderCommand,
	type ReminderPageRequest
} from '../model/reminder.contract'

export const listReminderRules = async (
	accessToken: string,
	input: ReminderPageRequest
) => {
	const request = structuredClone(input)
	if (!validReminderPageRequest(request)) throw invalidContractError()
	const result = parseReminderPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/sales/reminder-rules',
			params: {
				workspaceId: request.workspaceId,
				scope: request.scope,
				archived: String(request.archived),
				page: String(request.page),
				pageSize: String(request.pageSize),
				...(request.actor.membershipId !== null
					? { actorMembershipId: request.actor.membershipId }
					: {})
			}
		}),
		request
	)
	if (!result) throw invalidContractError()
	return result
}
export const mutateReminderRule = async (
	accessToken: string,
	input: ReminderCommand
) => {
	const command = structuredClone(input)
	if (
		!isUuidV4(command.commandId) ||
		!isUuidV4(command.workspaceId) ||
		!validReminderBinding(command.actor) ||
		!parseReminderRule(command.rule) ||
		!['create', 'edit', 'archive'].includes(command.action) ||
		(command.action === 'create'
			? command.expectedVersion !== undefined ||
				!sameReminderBinding(command.rule.ownerBinding, command.actor)
			: !Number.isSafeInteger(command.expectedVersion) ||
				command.expectedVersion! < 1 ||
				command.expectedVersion! > 2147483646) ||
		(command.rule.scope === 'PERSONAL' &&
			!sameReminderBinding(command.rule.ownerBinding, command.actor))
	)
		throw invalidContractError()
	const result = parseReminderResult(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: `/crm/sales/reminder-rules${command.action === 'create' ? '' : `/${command.rule.id}/${command.action}`}`,
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				schemaVersion: 1,
				workspaceId: command.workspaceId,
				commandId: command.commandId,
				actorMembershipId: command.actor.membershipId,
				...(command.action === 'create'
					? {}
					: { expectedVersion: command.expectedVersion }),
				...(command.action === 'archive' ? {} : { rule: command.rule })
			}
		}),
		command
	)
	if (!result) throw invalidContractError()
	return result
}
