import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import {
	parseAcceptanceResponse,
	type AcceptanceCommand
} from '../model/acceptance.contract'

const safeId = (id: string) => {
	if (!isUuidV4(id)) throw invalidContractError()
	return id
}
export const getInboxAcceptance = async (
	accessToken: string,
	workspaceId: string,
	entryId: string
) => {
	const result = parseAcceptanceResponse(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/intake/inbox/${safeId(entryId)}/acceptance`,
			params: { workspaceId: safeId(workspaceId) }
		}),
		workspaceId,
		entryId
	)
	if (!result) throw invalidContractError()
	return result
}
export const mutateInboxAcceptance = async (
	accessToken: string,
	command: AcceptanceCommand
) => {
	if (command.operation === 'accept') {
		const contact: unknown = command.contact
		if (
			!isRecord(contact) ||
			!(
				(contact.mode === 'EXISTING' &&
					hasExactKeys(contact, ['mode', 'contactId']) &&
					isUuidV4(contact.contactId)) ||
				(contact.mode === 'CREATE_FROM_ENTRY' &&
					(hasExactKeys(contact, ['mode']) ||
						(hasExactKeys(contact, ['mode', 'name']) &&
							isNonEmptyString(contact.name, 200) &&
							contact.name === contact.name.trim())))
			)
		)
			throw invalidContractError()
	}
	const base = {
		schemaVersion: 1,
		workspaceId: safeId(command.workspaceId),
		commandId: safeId(command.commandId),
		expectedVersion: command.expectedVersion
	}
	if (
		!Number.isSafeInteger(command.expectedVersion) ||
		command.expectedVersion < 1 ||
		command.expectedVersion > 2147483647 ||
		!['accept', 'retry', 'recover'].includes(command.operation)
	)
		throw invalidContractError()
	const result = parseAcceptanceResponse(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: `/crm/intake/inbox/${safeId(command.entryId)}/${command.operation === 'accept' ? 'accept' : `acceptance/${command.operation}`}`,
			headers: { 'Idempotency-Key': base.commandId },
			data:
				command.operation === 'accept'
					? {
							...base,
							contact:
								command.contact.mode === 'EXISTING'
									? {
											mode: 'EXISTING',
											contactId: safeId(command.contact.contactId)
										}
									: {
											mode: 'CREATE_FROM_ENTRY',
											...(command.contact.name !== undefined
												? { name: command.contact.name }
												: {})
										},
							deal: {
								title: command.deal.title,
								currency: command.deal.currency,
								amountMinor: command.deal.amountMinor,
								pipelineId: safeId(command.deal.pipelineId),
								stageId: safeId(command.deal.stageId),
								nextTask: {
									title: command.deal.nextTask.title,
									dueAt: command.deal.nextTask.dueAt
								}
							}
						}
					: base
		}),
		command.workspaceId,
		command.entryId
	)
	if (!result?.acceptance) throw invalidContractError()
	return result
}
