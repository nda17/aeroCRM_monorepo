'use client'

import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useWorkdaySession } from '@/entities/crm-workday'
import { useAssigneeOptions } from '@/entities/crm-team'
import {
	freezeSeriesCommand,
	mutateTaskSeries,
	type SeriesCommand,
	type SeriesMutation,
	type TaskSeries
} from '@/entities/crm-task-series'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import { workdayDirectoryContext } from './workday-form'

export const useTaskSeriesCommand = (
	onSaved: (series: TaskSeries) => void
) => {
	const context = useWorkdaySession(),
		client = useQueryClient()
	const self = useAssigneeOptions(workdayDirectoryContext(context), {
		selectedSubject: context.session?.userId
	})
	const actor =
		self.selected?.subject === context.session?.userId &&
		self.selected?.role === context.permissions.data?.role
			? self.selected
			: null
	const command = useMemoryCommand<SeriesCommand, TaskSeries>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: context.scopeKey
		},
		'workday:task-series',
		context.canWrite && !!actor,
		context.authorize,
		mutateTaskSeries,
		(row, confirmed) => {
			void client.invalidateQueries({ queryKey: ['crm-task-series'] })
			void client.invalidateQueries({ queryKey: ['crm-workday'] })
			toast.success(
				confirmed.mutation.kind !== 'status'
					? 'Серия задач сохранена'
					: row.status === 'CANCELLED'
						? 'Серия отменена. Созданные задачи сохранены.'
						: row.status === 'PAUSED'
							? 'Повторение приостановлено'
							: 'Серия задач сохранена'
			)
			onSaved(row)
		}
	)
	const blocked =
		!!command.error &&
		command.error.kind !== 'validation' &&
		!command.uncertain
	return {
		...command,
		context,
		actorConfirmed: !!actor,
		actorLoading: self.loading,
		recheckActor: self.refetch,
		blocked,
		locked: command.locked || blocked || !context.canWrite || !actor,
		canRetry: context.canWrite && !!actor && !command.running && !blocked,
		execute: async (mutation?: SeriesMutation) => {
			if (blocked || !actor || !context.session) return
			await command.execute(
				mutation
					? () =>
							freezeSeriesCommand({
								commandId: crypto.randomUUID(),
								workspaceId: context.workspace.workspaceId,
								subject: context.session!.userId,
								sessionRevision: context.sessionRevision,
								actorMembershipId:
									actor.role === 'OWNER' ? null : actor.membershipId,
								mutation
							})
					: undefined
			)
		},
		canClose: () => {
			if (!command.locked) return true
			toast('Сначала проверьте результат сохранения исходной команды.')
			return false
		}
	}
}
