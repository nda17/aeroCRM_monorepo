import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isIsoDate,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import {
	parseCrmDelivery,
	parseCrmInvitation,
	parseCrmMember,
	parseCrmTeam,
	parseTeamPage,
	type CrmRole,
	type TeamCollection
} from '../model/team.contract'
import {
	parseTeamOptions,
	type TeamOptionsRequest
} from '../model/team-options.contract'
import type { EmployeeName } from '../model/employee-profile.contract'

export const listTeamOptions = async (
	accessToken: string,
	request: TeamOptionsRequest
) => {
	const result = parseTeamOptions(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/access/team/options',
			params: {
				workspaceId: request.workspaceId,
				page: String(request.page),
				pageSize: String(request.pageSize),
				...(request.selectedId ? { selectedId: request.selectedId } : {})
			}
		}),
		request
	)
	if (!result) throw invalidContractError()
	return result
}

export const listTeamRecords = async (
	accessToken: string,
	workspaceId: string,
	collection: TeamCollection,
	page: number,
	pageSize = 20
) => {
	const result = parseTeamPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/access/team/${collection}`,
			params: {
				workspaceId,
				page: String(page),
				pageSize: String(pageSize)
			}
		}),
		workspaceId,
		collection,
		page,
		pageSize
	)
	if (!result) throw invalidContractError()
	return result
}
export type TeamMutation =
	| { kind: 'create-team'; name: string }
	| {
			kind: 'rename-team'
			id: string
			expectedVersion: number
			name: string
	  }
	| { kind: 'archive-team'; id: string; expectedVersion: number }
	| {
			kind: 'invite'
			email: string
			role: CrmRole
			teamIds: string[]
			ttlDays: number
			profile?: EmployeeName
	  }
	| { kind: 'revoke'; id: string; expectedVersion: number }
	| { kind: 'role'; id: string; expectedVersion: number; role: CrmRole }
	| {
			kind: 'teams'
			id: string
			expectedVersion: number
			teamIds: string[]
	  }
	| {
			kind: 'disable' | 'enable' | 'retry'
			id: string
			expectedVersion: number
	  }
export interface TeamCommand {
	workspaceId: string
	commandId: string
	mutation: TeamMutation
}
export interface TeamCommandResult {
	kind: TeamMutation['kind']
	id: string
}
export const mutateTeam = async (
	accessToken: string,
	command: TeamCommand
): Promise<TeamCommandResult> => {
	const { mutation, workspaceId, commandId } = command
	const { kind, ...fields } = mutation
	const id = 'id' in mutation ? mutation.id : undefined
	const paths: Record<TeamMutation['kind'], string> = {
		'create-team': 'teams',
		'rename-team': `teams/${id}/rename`,
		'archive-team': `teams/${id}/archive`,
		invite: 'invitations',
		revoke: `invitations/${id}/revoke`,
		role: `members/${id}/change-role`,
		teams: `members/${id}/set-teams`,
		disable: `members/${id}/disable`,
		enable: `members/${id}/enable`,
		retry: `deliveries/${id}/retry`
	}
	const data: Record<string, unknown> = {
		schemaVersion: 1,
		workspaceId,
		commandId,
		...fields
	}
	delete data.id
	const result = await authenticatedRequest({
		accessToken,
		method: 'POST',
		url: `/crm/access/team/${paths[kind]}`,
		headers: { 'Idempotency-Key': commandId },
		data
	})
	const key = ['create-team', 'rename-team', 'archive-team'].includes(kind)
		? 'team'
		: ['invite', 'revoke'].includes(kind)
			? 'invitation'
			: kind === 'enable'
				? 'admission'
				: kind === 'retry'
					? 'delivery'
					: 'member'
	if (
		!isRecord(result) ||
		!hasExactKeys(result, ['schemaVersion', key]) ||
		result.schemaVersion !== 1
	)
		throw invalidContractError()
	const value = result[key]
	if (kind === 'enable') {
		if (
			!isRecord(value) ||
			!hasExactKeys(value, [
				'id',
				'workspaceId',
				'memberId',
				'status',
				'createdAt'
			]) ||
			!isUuidV4(value.id) ||
			value.workspaceId !== workspaceId ||
			value.memberId !== id ||
			value.status !== 'WAITING' ||
			!isIsoDate(value.createdAt)
		)
			throw invalidContractError()
		return { kind, id: value.id }
	}
	const row =
		key === 'team'
			? parseCrmTeam(value, workspaceId)
			: key === 'invitation'
				? parseCrmInvitation(value, workspaceId)
				: key === 'delivery'
					? parseCrmDelivery(value, workspaceId)
					: parseCrmMember(value, workspaceId)
	if (
		!row ||
		(id && row.id !== id) ||
		('expectedVersion' in mutation
			? row.version !== mutation.expectedVersion + 1
			: row.version !== 1)
	)
		throw invalidContractError()
	if (kind === 'create-team' || kind === 'rename-team') {
		if (
			!('name' in row) ||
			row.name !== mutation.name.trim() ||
			row.archivedAt !== null
		)
			throw invalidContractError()
	}
	if (
		kind === 'archive-team' &&
		(!('archivedAt' in row) || row.archivedAt === null)
	)
		throw invalidContractError()
	if (
		kind === 'invite' &&
		(!('email' in row) ||
			row.email !== mutation.email.trim().toLowerCase() ||
			row.role !== mutation.role ||
			row.status !== 'REGISTERING' ||
			[...row.teamIds].sort().join() !==
				[...mutation.teamIds].sort().join())
	)
		throw invalidContractError()
	if (
		kind === 'revoke' &&
		(!('status' in row) || row.status !== 'REVOKED')
	)
		throw invalidContractError()
	if (kind === 'role' && (!('role' in row) || row.role !== mutation.role))
		throw invalidContractError()
	if (
		kind === 'teams' &&
		(!('teamIds' in row) ||
			[...row.teamIds].sort().join() !==
				[...mutation.teamIds].sort().join())
	)
		throw invalidContractError()
	if (
		kind === 'disable' &&
		(!('disabledAt' in row) || row.disabledAt === null)
	)
		throw invalidContractError()
	if (
		kind === 'retry' &&
		(!('manualRetryCycle' in row) ||
			row.status !== 'RETRY_SCHEDULED' ||
			row.retryAttempt !== 0)
	)
		throw invalidContractError()
	return { kind, id: row.id }
}
