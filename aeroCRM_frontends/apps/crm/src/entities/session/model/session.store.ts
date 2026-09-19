import type {
	AuthenticatedSession,
	SessionState
} from '@/entities/session/model/session.types'
import { create } from 'zustand'

interface SessionStore extends SessionState {
	setChecking: () => void
	setAuthenticated: (session: AuthenticatedSession) => void
	setAnonymous: () => void
	setError: (message: string) => void
}

const INITIAL_SESSION_STATE: SessionState = {
	status: 'checking',
	session: null,
	errorMessage: null,
	sessionRevision: 0
}

export const useSessionStore = create<SessionStore>(set => ({
	...INITIAL_SESSION_STATE,
	setChecking: () =>
		set(state => ({
			status: 'checking',
			session: null,
			errorMessage: null,
			sessionRevision: state.sessionRevision
		})),
	setAuthenticated: session =>
		set(state => ({
			status: 'authenticated',
			session,
			errorMessage: null,
			sessionRevision: state.sessionRevision + 1
		})),
	setAnonymous: () =>
		set(state => ({
			status: 'anonymous',
			session: null,
			errorMessage: null,
			sessionRevision: state.sessionRevision
		})),
	setError: errorMessage =>
		set(state => ({
			status: 'error',
			session: null,
			errorMessage,
			sessionRevision: state.sessionRevision
		}))
}))

export const resetSessionStore = () =>
	useSessionStore.setState(INITIAL_SESSION_STATE)
