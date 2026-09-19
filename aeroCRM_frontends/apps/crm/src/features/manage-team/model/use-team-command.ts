'use client'

import { getCrmPermissions } from '@/entities/crm-access'
import {
	mutateTeam,
	type TeamCommand,
	type TeamCommandResult,
	type TeamMutation
} from '@/entities/crm-team'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { useTeamSession } from './use-team-session'

export const useTeamCommand = (
	context: ReturnType<typeof useTeamSession>,
	intent: string,
	revoke: boolean,
	onSaved: (result: TeamCommandResult) => void
) => {
	const { workspace, session, sessionRevision, scopeKey } = context
	const queryClient = useQueryClient()
	const enabled = revoke ? context.canRevoke : context.canManage
	const command = useMemoryCommand<TeamCommand, TeamCommandResult>(
		{
			owner: commandOwner(session?.userId, sessionRevision),
			workspaceId: workspace.workspaceId,
			view: scopeKey
		},
		`team:${intent}`,
		enabled,
		async () => {
			if (!session || !navigator.onLine)
				throw new AuthenticatedApiError(
					'temporary',
					'Нет подключения к сети или действующей сессии.'
				)
			const permissions = await getCrmPermissions(
				session.accessToken,
				workspace.workspaceId
			)
			const assertCurrentSession = () => {
				const current = useSessionStore.getState()
				if (
					current.session?.accessToken !== session.accessToken ||
					current.sessionRevision !== sessionRevision ||
					permissions.subject !== current.session.userId
				)
					throw new AuthenticatedApiError(
						'unauthorized',
						'Сессия изменилась.'
					)
			}
			assertCurrentSession()
			const permissionsKey = [
				'crm-permissions',
				workspace.workspaceId,
				session.userId,
				sessionRevision
			] as const
			// A delayed permissions query must not restore an older, broader scope.
			await queryClient.cancelQueries({
				queryKey: permissionsKey,
				exact: true
			})
			assertCurrentSession()
			queryClient.setQueryData(permissionsKey, permissions)
			if (
				!['OWNER', 'CRM_ADMIN'].includes(permissions.role) ||
				permissions.state === 'READ_ONLY' ||
				!permissions.permissions.includes(
					revoke ? 'access:revoke-access' : 'access:manage-team'
				)
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Изменения команды недоступны для текущей роли или подписки.'
				)
			return session.accessToken
		},
		mutateTeam,
		result => {
			toast.success(
				result.kind === 'enable'
					? 'Запрос на включение принят. Сотрудник ожидает свободного места.'
					: result.kind === 'invite'
						? 'Приглашение создано. Подготовка выполняется в фоне.'
						: result.kind === 'retry'
							? 'Повторная обработка поставлена в очередь.'
							: 'Изменения сохранены'
			)
			onSaved(result)
		}
	)
	const blocked =
		!!command.error &&
		command.error.kind !== 'validation' &&
		!command.uncertain
	return {
		...command,
		enabled,
		blocked,
		locked: command.locked || blocked || !enabled,
		execute: async (mutation?: TeamMutation) => {
			if (blocked) return
			await command.execute(
				mutation
					? () => ({
							workspaceId: workspace.workspaceId,
							commandId: crypto.randomUUID(),
							mutation
						})
					: undefined
			)
		},
		canClose: () => {
			if (!command.locked) return true
			toast('Сначала подтвердите результат команды повторным запросом.')
			return false
		},
		resetAfterReview: () => {
			if (command.reset())
				toast(
					'Данные обновлены. Проверьте форму перед повторным сохранением.'
				)
		}
	}
}
