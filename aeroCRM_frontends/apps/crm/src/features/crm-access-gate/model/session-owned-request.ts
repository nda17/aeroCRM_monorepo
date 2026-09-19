import {
	useSessionStore,
	type AuthenticatedSession
} from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'

export interface SessionOwnedRequest<C, R> {
	command: C
	isCurrent: () => boolean
	execute: () => Promise<R>
}

// The request owns its guard, not the latest render's mutation callbacks.
// Tokens stay in a private closure instead of mutation variables/snapshots.
export const sessionOwnedRequest = <C, R>(
	session: AuthenticatedSession | null,
	revision: number,
	command: C,
	send: (token: string, command: C) => Promise<R>
): SessionOwnedRequest<C, R> => {
	const isCurrent = () => {
		const current = useSessionStore.getState()
		return (
			!!session &&
			current.status === 'authenticated' &&
			current.session?.userId === session.userId &&
			current.session?.accessToken === session.accessToken &&
			current.sessionRevision === revision
		)
	}
	return {
		command,
		isCurrent,
		execute: async () => {
			if (!session || !isCurrent())
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия изменилась.'
				)
			return send(session.accessToken, command)
		}
	}
}
