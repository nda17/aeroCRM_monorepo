'use client'

import { getCrmPermissions } from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import toast from 'react-hot-toast'
import type { useSalesSession } from './use-sales-session'

export type CommerceContext = ReturnType<typeof useSalesSession>
export type CommerceCommandBase = {
	schemaVersion: 1
	workspaceId: string
	commandId: string
}

export const useCommerceCommand = <I extends object, R>(
	context: CommerceContext,
	intent: string,
	send: (token: string, input: I & CommerceCommandBase) => Promise<R>,
	onSuccess: (result: R) => void,
	permission = 'sales:write'
) => {
	const enabled =
		context.canWrite &&
		context.permissions.data?.permissions.includes(permission) === true
	const command = useMemoryCommand<I & CommerceCommandBase, R>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: context.scopeKey
		},
		`commerce:${intent}`,
		enabled,
		async () => {
			if (!navigator.onLine)
				throw new AuthenticatedApiError(
					'temporary',
					'Нет подключения к сети.'
				)
			const token = context.session?.accessToken || ''
			const authority = await getCrmPermissions(
				token,
				context.workspace.workspaceId
			)
			const current = useSessionStore.getState()
			if (
				current.session?.accessToken !== token ||
				current.sessionRevision !== context.sessionRevision ||
				authority.subject !== current.session?.userId
			)
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия изменилась.'
				)
			if (
				authority.state === 'READ_ONLY' ||
				authority.role === 'ANALYST' ||
				!authority.permissions.includes(permission) ||
				(permission === 'sales:manage-pipelines' &&
					!['OWNER', 'CRM_ADMIN'].includes(authority.role))
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Для этого действия недостаточно прав.'
				)
			return token
		},
		send,
		result => {
			toast.success('Изменения сохранены')
			onSuccess(result)
		}
	)
	const blocked =
		!!command.error &&
		!command.uncertain &&
		command.error.kind !== 'validation'
	return {
		...command,
		blocked,
		enabled,
		locked: command.locked || blocked || !enabled,
		execute: (input?: I) => {
			if (blocked) return Promise.resolve()
			return command.execute(
				input
					? () => ({
							...input,
							schemaVersion: 1,
							workspaceId: context.workspace.workspaceId,
							commandId: crypto.randomUUID()
						})
					: undefined
			)
		},
		canClose: () => {
			if (!command.locked) return true
			toast('Сначала подтвердите результат сохранения повторным запросом.')
			return false
		}
	}
}
