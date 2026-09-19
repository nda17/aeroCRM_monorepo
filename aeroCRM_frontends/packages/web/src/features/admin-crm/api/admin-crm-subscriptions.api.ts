import {
	axiosClassicRequest,
	axiosInterceptorsRequest,
	getAccessToken,
	isAccessTokenValid
} from '@/shared/api'
import { decodeJwt } from 'jose'
import {
	CRM_ADMIN_UUID,
	CrmAdminGrantNotSentError,
	parseCrmAdminCommandRecovery,
	parseCrmAdminGrantResult,
	parseCrmAdminHistory,
	parseCrmAdminPage,
	parseCrmAdminSubscription,
	parseCrmAdminSubscriptionDetail,
	type CrmAdminGrantCommand
} from '../model/crm-subscriptions.contract'

const BASE = '/subscriptions/admin/crm'
const workspacePath = (workspaceId: string) => {
	if (!CRM_ADMIN_UUID.test(workspaceId))
		throw new Error('Invalid CRM workspace')
	return `${BASE}/${workspaceId}`
}
const actorBoundBearer = (actorSubject: string): string => {
	try {
		const accessToken = getAccessToken()
		if (
			!accessToken ||
			!isAccessTokenValid(accessToken) ||
			decodeJwt(accessToken).sub !== actorSubject
		)
			throw new CrmAdminGrantNotSentError()
		return accessToken
	} catch {
		throw new CrmAdminGrantNotSentError()
	}
}

export const adminCrmSubscriptionsService = {
	async list(page: number, pageSize: number, ownerSubject?: string) {
		const { data } = await axiosInterceptorsRequest.get<unknown>(BASE, {
			params: { page, pageSize, ownerSubject },
			timeout: 15_000
		})
		const result = parseCrmAdminPage(
			data,
			parseCrmAdminSubscription,
			page,
			pageSize
		)
		if (
			ownerSubject &&
			result.items.some(item => item.ownerSubject !== ownerSubject)
		)
			throw new Error('Unexpected CRM subscription owner')
		if (
			new Set(result.items.map(item => item.workspaceId)).size !==
			result.items.length
		)
			throw new Error('Duplicate CRM workspaces')
		return result
	},
	async detail(workspaceId: string) {
		const { data } = await axiosInterceptorsRequest.get<unknown>(
			workspacePath(workspaceId),
			{ timeout: 15_000 }
		)
		return parseCrmAdminSubscriptionDetail(data, workspaceId)
	},
	async history(workspaceId: string, page: number, pageSize: number) {
		const { data } = await axiosInterceptorsRequest.get<unknown>(
			`${workspacePath(workspaceId)}/history`,
			{ params: { page, pageSize }, timeout: 15_000 }
		)
		return parseCrmAdminHistory(data, workspaceId, page, pageSize)
	},
	async extendDays(
		workspaceId: string,
		actorSubject: string,
		command: CrmAdminGrantCommand
	) {
		// A grant cannot follow the shared client's 401 -> refresh -> replay path:
		// a concurrent login may replace that request's principal. Pin one bearer
		// snapshot and let the server verify expectedActorSubject authoritatively.
		if (command.expectedActorSubject !== actorSubject)
			throw new CrmAdminGrantNotSentError()
		const accessToken = actorBoundBearer(actorSubject)
		const { data } = await axiosClassicRequest.post<unknown>(
			`${workspacePath(workspaceId)}/extend-days`,
			command,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Idempotency-Key': command.commandId
				},
				timeout: 30_000
			}
		)
		return parseCrmAdminGrantResult(
			data,
			workspaceId,
			command.commandId,
			actorSubject,
			command
		)
	},
	async command(
		workspaceId: string,
		commandId: string,
		actorSubject: string
	) {
		if (!CRM_ADMIN_UUID.test(commandId))
			throw new Error('Invalid CRM command')
		const { data } = await axiosInterceptorsRequest.get<unknown>(
			`${workspacePath(workspaceId)}/commands/${commandId}`,
			{ timeout: 15_000 }
		)
		return parseCrmAdminCommandRecovery(
			data,
			workspaceId,
			commandId,
			actorSubject
		)
	},
	async cancelCommand(
		workspaceId: string,
		commandId: string,
		actorSubject: string
	) {
		if (!CRM_ADMIN_UUID.test(commandId))
			throw new Error('Invalid CRM command')
		const accessToken = actorBoundBearer(actorSubject)
		const { data } = await axiosClassicRequest.post<unknown>(
			`${workspacePath(workspaceId)}/commands/${commandId}/cancel`,
			{ schemaVersion: 1, expectedActorSubject: actorSubject },
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Idempotency-Key': commandId
				},
				timeout: 30_000
			}
		)
		return parseCrmAdminCommandRecovery(
			data,
			workspaceId,
			commandId,
			actorSubject
		)
	}
}
