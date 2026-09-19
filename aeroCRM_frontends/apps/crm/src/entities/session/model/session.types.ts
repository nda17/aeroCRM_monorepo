export type SessionStatus =
	| 'checking'
	| 'authenticated'
	| 'anonymous'
	| 'error'

export interface AuthenticatedSession {
	/** Original issued token is a stable CRM session binding. The transport keeps
	 * renewed same-session Bearers privately; never log, serialize or persist them. */
	accessToken: string
	userId: string
}

export interface SessionState {
	status: SessionStatus
	session: AuthenticatedSession | null
	errorMessage: string | null
	sessionRevision: number
}
