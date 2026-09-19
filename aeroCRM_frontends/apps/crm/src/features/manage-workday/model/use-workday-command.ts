'use client'

import {
	freezeWorkdayCommand,
	mutateWorkdayTask,
	useWorkdaySession,
	type WorkdayCommand,
	type WorkdayMutation,
	type WorkdayTask
} from '@/entities/crm-workday'
import {
	commandOwner,
	useMemoryCommand,
	usePendingCommand,
	type CommandSnapshot
} from '@/shared/lib/pending-command'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

export type WorkdayCommandContext = Pick<
	ReturnType<typeof useWorkdaySession>,
	'workspace' | 'session' | 'sessionRevision' | 'scopeKey'
>
const scopeFor = (context: WorkdayCommandContext) => ({
	owner: commandOwner(context.session?.userId, context.sessionRevision),
	workspaceId: context.workspace.workspaceId,
	view: context.scopeKey
})
const unresolved = (snapshot: CommandSnapshot) =>
	snapshot.status === 'running' ||
	snapshot.status === 'success' ||
	snapshot.uncertain
// Observe the existing opaque task-drawer intent, without exposing its body or
// introducing a second pending store for list/board actions.
export const useWorkdayTaskCommandState = (
	context: WorkdayCommandContext,
	taskId: string
) => {
	const { snapshot } = usePendingCommand(
		scopeFor(context),
		`workday:task:${taskId}`
	)
	return { unresolved: unresolved(snapshot) }
}

export const useWorkdayCommand = (
	intent: string,
	onSaved: (task: WorkdayTask, command: WorkdayCommand) => void
) => {
	const context = useWorkdaySession()
	const client = useQueryClient()
	const scope = scopeFor(context)
	const { coordinator } = usePendingCommand(scope, `workday:${intent}`)
	const command = useMemoryCommand<WorkdayCommand, WorkdayTask>(
		scope,
		`workday:${intent}`,
		context.canWrite,
		context.authorize,
		mutateWorkdayTask,
		(task, confirmed) => {
			void client.invalidateQueries({ queryKey: ['crm-workday'] })
			void client.invalidateQueries({ queryKey: ['sales'] })
			toast.success('Задача сохранена')
			onSaved(task, confirmed)
		}
	)
	const blocked =
		!!command.error &&
		command.error.kind !== 'validation' &&
		!command.uncertain
	return {
		context,
		hasPendingTask: (taskId: string) =>
			unresolved(coordinator.get(scope, `workday:task:${taskId}`)),
		error: command.error,
		pending: command.running,
		ambiguous: command.uncertain,
		blocked,
		locked: command.locked || blocked || !context.canWrite,
		canRetry: context.canWrite && !command.running && !blocked,
		execute: async (mutation?: WorkdayMutation) => {
			if (blocked) return
			await command.execute(
				mutation
					? () =>
							freezeWorkdayCommand({
								workspaceId: context.workspace.workspaceId,
								subject: context.session!.userId,
								sessionRevision: context.sessionRevision,
								commandId: crypto.randomUUID(),
								mutation
							})
					: undefined
			)
		},
		resetAfterReview: () => command.reset(),
		canClose: () => {
			if (!command.locked) return true
			toast('Сначала подтвердите результат сохранения повторным запросом.')
			return false
		}
	}
}
