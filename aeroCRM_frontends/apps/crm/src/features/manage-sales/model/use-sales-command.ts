'use client'

import {
	mutateSales,
	type SalesCommand,
	type SalesDeal,
	type SalesMutation
} from '@/entities/sales'
import { getCrmPermissions } from '@/entities/crm-access'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useSessionStore } from '@/entities/session'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import toast from 'react-hot-toast'

export const useSalesCommand = (
	workspaceId: string,
	accessToken: string,
	enabled: boolean,
	onSuccess: (deal: SalesDeal) => void,
	intent = 'deal:new',
	view?: string
) => {
	const { session, sessionRevision } = useSessionStore()
	const owner = commandOwner(session?.userId, sessionRevision)
	const command = useMemoryCommand<SalesCommand, SalesDeal>(
		{ owner, workspaceId, view },
		`sales:${intent}`,
		enabled,
		async () => {
			if (!navigator.onLine)
				throw new AuthenticatedApiError(
					'temporary',
					'Нет подключения к сети.'
				)
			const permissions = await getCrmPermissions(accessToken, workspaceId)
			const current = useSessionStore.getState()
			if (
				!current.session ||
				current.session.accessToken !== accessToken ||
				current.sessionRevision !== sessionRevision ||
				permissions.subject !== current.session.userId
			)
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия изменилась.'
				)
			if (
				permissions.state === 'READ_ONLY' ||
				!permissions.permissions.includes('sales:write')
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Изменения недоступны для текущей роли или подписки.'
				)
			return current.session.accessToken
		},
		async (token, pending) => {
			try {
				return await mutateSales(token, pending)
			} catch (error) {
				const current = useSessionStore.getState()
				if (
					error instanceof AuthenticatedApiError &&
					error.kind === 'unauthorized' &&
					current.session?.accessToken === token &&
					current.sessionRevision === sessionRevision
				)
					current.setAnonymous()
				throw error
			}
		},
		result => {
			toast.success('Изменения сохранены')
			onSuccess(result)
		}
	)
	const execute = async (mutation?: SalesMutation) => {
		if (blocked) return
		await command.execute(
			mutation
				? () => ({ workspaceId, commandId: crypto.randomUUID(), mutation })
				: undefined
		)
	}
	const blocked =
		!!command.error &&
		command.error.kind !== 'validation' &&
		!command.uncertain
	return {
		execute,
		pending: command.running,
		error: command.error,
		ambiguous: command.uncertain,
		blocked,
		canRetry: enabled && !command.running && !blocked,
		locked: command.locked || blocked || !enabled,
		resetAfterReview: () => {
			if (command.reset())
				toast('Данные обновлены. Проверьте форму перед сохранением.')
		},
		canClose: () => {
			if (!command.locked) return true
			toast('Сначала подтвердите результат сохранения повторным запросом.')
			return false
		}
	}
}
