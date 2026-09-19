'use client'

import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	crmPermissionScope,
	getCrmPermissions
} from '@/entities/crm-access'
import { listAssigneeOptions } from '@/entities/crm-team'
import {
	mutateReminderRule,
	sameReminderBinding,
	type ReminderCommand,
	type ReminderResult,
	type ReminderScope
} from '@/entities/crm-reminders'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import type { ReminderContext } from './use-reminder-session'

export const useReminderCommand = (
	context: ReminderContext,
	scope: ReminderScope,
	enabled: boolean,
	onSaved: () => void
) => {
	const queryClient = useQueryClient()
	return useMemoryCommand<ReminderCommand, ReminderResult>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: JSON.stringify([context.scopeKey, context.actor])
		},
		`reminder-rules:${scope}`,
		enabled,
		async () => {
			if (
				!context.current() ||
				!context.session ||
				!context.actor ||
				!navigator.onLine
			)
				throw new AuthenticatedApiError(
					'temporary',
					'Нет действующего доступа или подключения к сети.'
				)
			const fresh = await getCrmPermissions(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			if (
				!context.current() ||
				crmPermissionScope(fresh) !== context.scopeKey ||
				fresh.subject !== context.session.userId ||
				fresh.workspaceId !== context.workspace.workspaceId ||
				fresh.state === 'READ_ONLY' ||
				!fresh.permissions.includes('sales:write') ||
				fresh.role === 'ANALYST' ||
				(scope === 'WORKSPACE' &&
					!['OWNER', 'CRM_ADMIN'].includes(fresh.role))
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Права изменились. Обновите настройки.'
				)
			const self = await listAssigneeOptions(context.session.accessToken, {
				workspaceId: fresh.workspaceId,
				subject: fresh.subject,
				dataScope: fresh.dataScope,
				page: 1,
				pageSize: 1,
				selectedSubject: fresh.subject
			})
			const actor = self.selected
			if (
				!context.current() ||
				!actor ||
				actor.role !== fresh.role ||
				!sameReminderBinding(context.actor, {
					subject: actor.subject,
					membershipId: actor.role === 'OWNER' ? null : actor.membershipId
				})
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Доступ сотрудника изменился. Обновите настройки.'
				)
			return context.session.accessToken
		},
		mutateReminderRule,
		() => {
			toast.success('Настройки напоминания сохранены')
			void queryClient.invalidateQueries({
				queryKey: ['crm-reminders', context.workspace.workspaceId]
			})
			onSaved()
		}
	)
}
