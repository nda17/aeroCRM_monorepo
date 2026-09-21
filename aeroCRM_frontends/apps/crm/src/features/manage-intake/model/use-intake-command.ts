'use client'

import { canAcceptInbox } from '@/entities/crm-access'

import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import type { IntakeAccess } from './use-intake-access'

export const useIntakeCommand = <T extends { commandId: string }, R>(
	access: IntakeAccess,
	permission: 'intake:write' | 'intake:manage-sources' | 'intake:accept',
	send: (token: string, command: T) => Promise<R>,
	onSuccess: (result: R, command: T) => void,
	intent: string
) => {
	const command = useMemoryCommand(
		{
			owner: commandOwner(access.session?.userId, access.revision),
			workspaceId: access.workspaceId,
			view: access.scopeKey
		},
		`intake:${intent}`,
		access.online &&
			(permission === 'intake:accept'
				? access.canWrite && canAcceptInbox(access.permissions.data)
				: permission === 'intake:write'
					? access.canWrite
					: access.canManageSources),
		() => access.authorize(permission),
		send,
		onSuccess
	)
	return {
		run: command.execute,
		retry: () => command.execute(),
		running: command.running,
		uncertain: command.uncertain,
		locked: command.locked,
		error: command.error,
		resetError: command.reset
	}
}
