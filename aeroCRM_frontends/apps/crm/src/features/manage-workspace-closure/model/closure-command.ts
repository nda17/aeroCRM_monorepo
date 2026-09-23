import type { WorkspaceClosureCommand } from '@/entities/workspace-closure'
import { useSessionStore } from '@/entities/session'

// A lost POST response must not cause a second close command after the gate
// replaces Settings with the closure view. This memory is session scoped.
const pending = new Map<string, WorkspaceClosureCommand>()

useSessionStore.subscribe(state => {
	if (state.status !== 'authenticated' || !state.session) {
		pending.clear()
		return
	}
	const prefix = `${state.session.userId}:${state.sessionRevision}:`
	for (const scope of pending.keys()) {
		if (!scope.startsWith(prefix)) pending.delete(scope)
	}
})

export const pendingClosureCommand = (scope: string) =>
	pending.get(scope) ?? null

export const retainClosureCommand = (
	scope: string,
	command: WorkspaceClosureCommand
) => {
	pending.set(scope, command)
}

export const clearClosureCommand = (scope: string) => {
	pending.delete(scope)
}
