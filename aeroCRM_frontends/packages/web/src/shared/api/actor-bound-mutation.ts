import { axiosClassicRequest } from './browser-client'
import {
	getAccessToken,
	getSessionRevision,
	getTokenBinding,
	isAccessTokenValid
} from './token-storage'

export class ActorMutationNotSentError extends Error {
	constructor() {
		super(
			'Сессия изменилась или истекла. Обновите данные перед сохранением.'
		)
	}
}

/** Capture the current session; mutations deliberately bypass automatic replay. */
export const readMutationActor = (subject: string) => {
	const accessToken = getAccessToken()
	const binding = getTokenBinding(accessToken)
	if (
		!binding ||
		binding.subject !== subject ||
		!isAccessTokenValid(accessToken)
	)
		throw new ActorMutationNotSentError()
	return {
		subject,
		sessionId: binding.sessionId,
		revision: getSessionRevision()
	}
}

export type MutationActor = ReturnType<typeof readMutationActor>

export const isMutationActorCurrent = (actor: MutationActor) => {
	const current = getTokenBinding(getAccessToken())
	return (
		current?.subject === actor.subject &&
		current.sessionId === actor.sessionId &&
		getSessionRevision() === actor.revision
	)
}

export const actorBoundMutation = async (
	actor: MutationActor,
	url: string,
	command: { commandId: string }
): Promise<unknown> => {
	const accessToken = getAccessToken()
	if (!isMutationActorCurrent(actor) || !isAccessTokenValid(accessToken))
		throw new ActorMutationNotSentError()
	const { data } = await axiosClassicRequest.post<unknown>(url, command, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Idempotency-Key': command.commandId
		},
		timeout: 30_000
	})
	if (!isMutationActorCurrent(actor))
		throw new Error('Сессия изменилась после отправки команды.')
	return data
}
