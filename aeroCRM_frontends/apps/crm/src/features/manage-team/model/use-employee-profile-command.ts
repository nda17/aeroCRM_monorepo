'use client'

import { getCrmPermissions } from '@/entities/crm-access'
import {
	updateEmployeeProfile,
	type EmployeeName,
	type EmployeeProfileCommand,
	type EmployeeProfileResponse
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

export const useEmployeeProfileCommand = (
	context: ReturnType<typeof useTeamSession>,
	targetSubject: string,
	enabled: boolean,
	onSaved: () => void
) => {
	const { workspace, session, sessionRevision, scopeKey } = context
	const queryClient = useQueryClient()
	const command = useMemoryCommand<
		EmployeeProfileCommand,
		EmployeeProfileResponse
	>(
		{
			owner: commandOwner(session?.userId, sessionRevision),
			workspaceId: workspace.workspaceId,
			view: scopeKey
		},
		`employee-profile:${targetSubject}`,
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
			const assertSession = () => {
				const current = useSessionStore.getState()
				if (
					current.session?.accessToken !== session.accessToken ||
					current.sessionRevision !== sessionRevision ||
					permissions.subject !== session.userId ||
					permissions.workspaceId !== workspace.workspaceId
				)
					throw new AuthenticatedApiError(
						'unauthorized',
						'Сессия изменилась.'
					)
			}
			assertSession()
			const queryKey = [
				'crm-permissions',
				workspace.workspaceId,
				session.userId,
				sessionRevision
			]
			await queryClient.cancelQueries({ queryKey, exact: true })
			assertSession()
			queryClient.setQueryData(queryKey, permissions)
			if (
				permissions.state === 'READ_ONLY' ||
				(targetSubject !== session.userId &&
					(!['OWNER', 'CRM_ADMIN'].includes(permissions.role) ||
						!permissions.permissions.includes('access:manage-team')))
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Изменение ФИО недоступно для текущей роли или подписки.'
				)
			return session.accessToken
		},
		updateEmployeeProfile,
		() => {
			void queryClient.invalidateQueries({
				queryKey: ['crm-team', workspace.workspaceId]
			})
			void queryClient.invalidateQueries({
				queryKey: ['crm-employee-profile', workspace.workspaceId]
			})
			toast.success('ФИО сохранено')
			onSaved()
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
		execute: async (value?: {
			profile: EmployeeName
			expectedVersion: number
		}) => {
			if (blocked) return
			await command.execute(
				value
					? () => ({
							...value,
							workspaceId: workspace.workspaceId,
							subject: session!.userId,
							targetSubject,
							commandId: crypto.randomUUID()
						})
					: undefined
			)
		},
		canClose: () => {
			if (!command.locked) return true
			toast('Сначала подтвердите результат команды повторным запросом.')
			return false
		}
	}
}
