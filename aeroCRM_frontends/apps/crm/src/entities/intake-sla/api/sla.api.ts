import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	parseInboxSla,
	parseSlaRule,
	validInboxSlaIds,
	validSlaCommand,
	type SlaCommand,
	type SlaConfig
} from '../model/sla.contract'

const configIdentity = (config: SlaConfig) =>
	JSON.stringify([
		config.enabled,
		config.workingMinutes,
		config.timeZone,
		[...config.weekdays].sort((left, right) => left - right),
		config.workStart,
		config.workEnd,
		config.responsibleBinding
			? [
					config.responsibleBinding.subject,
					config.responsibleBinding.membershipId
				]
			: null,
		config.notifyManagers,
		[...config.channels].sort()
	])

export const getSlaRule = async (
	accessToken: string,
	workspaceId: string
) => {
	if (!isUuidV4(workspaceId)) throw invalidContractError()
	const result = parseSlaRule(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/intake/sla/rule',
			params: { workspaceId }
		}),
		workspaceId
	)
	if (!result) throw invalidContractError()
	return result
}
export const saveSlaRule = async (
	accessToken: string,
	input: SlaCommand
) => {
	const command = structuredClone(input)
	if (!validSlaCommand(command)) throw invalidContractError()
	const result = parseSlaRule(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: '/crm/intake/sla/rule',
			headers: { 'Idempotency-Key': command.commandId },
			data: command
		}),
		command.workspaceId
	)
	if (
		!result?.rule ||
		result.rule.version !== command.expectedVersion + 1 ||
		configIdentity(result.rule.config) !== configIdentity(command.config)
	)
		throw invalidContractError()
	return result
}
export const listInboxSla = async (
	accessToken: string,
	workspaceId: string,
	entryIds: string[]
) => {
	const ids = [...entryIds]
	if (!isUuidV4(workspaceId) || !validInboxSlaIds(ids))
		throw invalidContractError()
	const result = parseInboxSla(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/intake/sla/inbox-status',
			params: { workspaceId, entryIds: ids.join(',') }
		}),
		workspaceId,
		ids
	)
	if (!result) throw invalidContractError()
	return result
}
