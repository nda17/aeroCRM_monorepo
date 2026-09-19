import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	parseInboxEntry,
	parseIntakeActivity,
	parseIntakePage,
	parseIntakeResult,
	parseIntakeSource,
	type InboxStatus
} from '../model/intake.contract'

const root = '/crm/intake'
const checked = <T>(value: T | null): T => {
	if (value === null) throw invalidContractError()
	return value
}
const safeId = (id: string) => {
	if (!isUuidV4(id)) throw invalidContractError()
	return id
}
export const listInbox = async (
	accessToken: string,
	workspaceId: string,
	page: number,
	pageSize: number,
	search: string,
	status: InboxStatus | ''
) =>
	checked(
		parseIntakePage(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${root}/inbox`,
				params: {
					workspaceId: safeId(workspaceId),
					page: String(page),
					pageSize: String(pageSize),
					...(search ? { search } : {}),
					...(status ? { status } : {})
				}
			}),
			page,
			pageSize,
			item => parseInboxEntry(item, workspaceId)
		)
	)
export const getInboxEntry = async (
	accessToken: string,
	workspaceId: string,
	id: string
) =>
	checked(
		parseIntakeResult(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${root}/inbox/${safeId(id)}`,
				params: { workspaceId: safeId(workspaceId) }
			}),
			'entry',
			item => parseInboxEntry(item, workspaceId),
			id
		)
	)
export const listIntakeActivities = async (
	accessToken: string,
	workspaceId: string,
	id: string,
	page: number
) =>
	checked(
		parseIntakePage(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${root}/inbox/${safeId(id)}/activities`,
				params: {
					workspaceId: safeId(workspaceId),
					page: String(page),
					pageSize: '25'
				}
			}),
			page,
			25,
			item => parseIntakeActivity(item, workspaceId, id)
		)
	)
export const listIntakeSources = async (
	accessToken: string,
	workspaceId: string,
	page: number
) =>
	checked(
		parseIntakePage(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${root}/sources`,
				params: {
					workspaceId: safeId(workspaceId),
					page: String(page),
					pageSize: '25'
				}
			}),
			page,
			25,
			item => parseIntakeSource(item, workspaceId)
		)
	)

interface CommandBase {
	workspaceId: string
	commandId: string
}
export type InboxCommand = CommandBase &
	(
		| {
				operation: 'create'
				title: string
				name: string
				phone: string | null
				email: string | null
				message: string | null
				teamId: string | null
		  }
		| {
				operation: 'reject'
				id: string
				expectedVersion: number
				reason: string
		  }
	)
export type SourceCommand = CommandBase &
	(
		| {
				operation: 'create'
				name: string
				token: string
				teamId: string | null
		  }
		| {
				operation: 'rotate'
				id: string
				expectedVersion: number
				token: string
		  }
		| { operation: 'revoke'; id: string; expectedVersion: number }
	)

export const mutateInbox = async (
	accessToken: string,
	command: InboxCommand
) => {
	safeId(command.workspaceId)
	const { operation, ...data } = command
	const id = operation === 'reject' ? safeId(command.id) : undefined
	const { id: _id, ...body } = data as typeof data & { id?: string }
	void _id
	const result = checked(
		parseIntakeResult(
			await authenticatedRequest({
				accessToken,
				method: 'POST',
				url: `${root}/inbox${id ? `/${id}/reject` : ''}`,
				headers: { 'Idempotency-Key': safeId(command.commandId) },
				data: { schemaVersion: 1, ...body }
			}),
			'entry',
			item => parseInboxEntry(item, command.workspaceId),
			id
		)
	)
	if (result.status !== (operation === 'reject' ? 'REJECTED' : 'NEW'))
		throw invalidContractError()
	return result
}
export const mutateIntakeSource = async (
	accessToken: string,
	command: SourceCommand
) => {
	safeId(command.workspaceId)
	const { operation, ...data } = command
	const id = operation === 'create' ? undefined : safeId(command.id)
	const { id: _id, ...body } = data as typeof data & { id?: string }
	void _id
	const suffix =
		operation === 'create'
			? ''
			: `/${id}/${operation === 'rotate' ? 'rotate-token' : 'revoke'}`
	const result = checked(
		parseIntakeResult(
			await authenticatedRequest({
				accessToken,
				method: 'POST',
				url: `${root}/sources${suffix}`,
				headers: { 'Idempotency-Key': safeId(command.commandId) },
				data: { schemaVersion: 1, ...body }
			}),
			'source',
			item => parseIntakeSource(item, command.workspaceId),
			id
		)
	)
	if ((operation === 'revoke') !== (result.revokedAt !== null))
		throw invalidContractError()
	return result
}
