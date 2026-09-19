'use client'

import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useLayoutEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { commandCapsule, type CommandScope } from './coordinator'
import { usePendingCommand } from './context'

export const useMemoryCommand = <C extends { commandId: string }, R>(
	scope: CommandScope,
	intent: string,
	enabled: boolean,
	authorize: () => Promise<string>,
	send: (token: string, command: C) => Promise<R>,
	onSuccess: (result: R, command: C) => void,
	recover?: (token: string, command: C) => Promise<R>
) => {
	const { coordinator, snapshot } = usePendingCommand(scope, intent)
	const mounted = useRef(true)
	const current = useRef({ scope, intent, enabled, onSuccess })
	useLayoutEffect(() => {
		current.current = { scope, intent, enabled, onSuccess }
	}, [scope, intent, enabled, onSuccess])
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			coordinator.reset(current.current.scope, current.current.intent)
		}
	}, [coordinator])
	const sameObserver = () =>
		mounted.current &&
		current.current.scope.owner === scope.owner &&
		current.current.scope.workspaceId === scope.workspaceId &&
		current.current.scope.view === scope.view &&
		current.current.intent === intent &&
		coordinator.current(scope)
	const relevant = () => sameObserver() && current.current.enabled
	const execute = async (build?: () => C, recovering = false) => {
		if (!enabled || !relevant()) return
		try {
			// Late results are revalidated by replaying the original command, not
			// exposing an old response after permissions may have narrowed.
			await coordinator.run(
				scope,
				intent,
				async () => {
					const token = await authorize()
					if (!sameObserver())
						throw new AuthenticatedApiError(
							'temporary',
							'Редактор закрыт. Сохранённая команда не изменена.'
						)
					return token
				},
				build ? () => commandCapsule(build(), send, recover) : undefined,
				recovering ? 'recover' : 'execute'
			)
			if (!relevant()) return
			const state = coordinator.get(scope, intent)
			if (state.status === 'success') {
				coordinator.consume<C, R>(scope, intent, (result, command) =>
					current.current.onSuccess(result, command)
				)
			} else if (state.error) toast.error(state.error.message)
		} catch {
			if (relevant())
				toast.error(
					'Не удалось подтвердить доступ. Сохранённая команда не изменена.'
				)
		}
	}
	const received = snapshot.status === 'success'
	const error = snapshot.error
		? new AuthenticatedApiError(
				snapshot.error.kind,
				snapshot.error.message
			)
		: received
			? new AuthenticatedApiError(
					'temporary',
					'Ответ на сохранённую команду получен. Подтвердите просмотр результата.'
				)
			: null
	return {
		execute,
		recover: () => execute(undefined, true),
		error,
		running: snapshot.status === 'running',
		uncertain: snapshot.uncertain || received,
		locked:
			snapshot.status === 'running' || snapshot.uncertain || received,
		reset: () => coordinator.reset(scope, intent),
		snapshot
	}
}
