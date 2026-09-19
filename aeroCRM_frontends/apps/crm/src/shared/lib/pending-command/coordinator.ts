import {
	AuthenticatedApiError,
	type AuthenticatedApiErrorKind
} from '@/shared/api/authenticated-http-client'

export interface CommandScope {
	owner: string
	workspaceId: string
	view?: string
}
export interface CommandSnapshot {
	status:
		| 'idle'
		| 'running'
		| 'unknown'
		| 'blocked'
		| 'success'
		| 'rejected'
	commandId: string | null
	error: { kind: AuthenticatedApiErrorKind; message: string } | null
	uncertain: boolean
}

// A capsule is opaque to observers. In particular source credentials never
// enter a public snapshot, query/mutation cache, persistence or telemetry.
export interface CommandCapsule {
	readonly commandId: string
	execute: (accessToken: string) => Promise<void>
	recover?: (accessToken: string) => Promise<void>
	deliver: (consume: (result: unknown, command: unknown) => void) => void
	destroy: () => void
}
const freeze = <T>(value: T): T => {
	if (value && typeof value === 'object') {
		Object.values(value).forEach(freeze)
		Object.freeze(value)
	}
	return value
}
export const commandCapsule = <C extends { commandId: string }, R>(
	input: C,
	send: (token: string, command: C) => Promise<R>,
	recover?: (token: string, command: C) => Promise<R>
): CommandCapsule => {
	let command: C | null = freeze(structuredClone(input))
	let result: R | undefined
	let destroyed = false
	return {
		commandId: input.commandId,
		async execute(token) {
			if (!command || destroyed) throw new Error('Command unavailable')
			const received = await send(token, command)
			if (!destroyed) result = received
		},
		...(recover
			? {
					async recover(token: string) {
						if (!command || destroyed)
							throw new Error('Command unavailable')
						const received = await recover(token, command)
						if (!destroyed) result = received
					}
				}
			: {}),
		deliver(consume) {
			if (!destroyed && command) consume(result, command)
		},
		destroy() {
			destroyed = true
			command = null
			result = undefined
		}
	}
}
const idle: CommandSnapshot = Object.freeze({
	status: 'idle',
	commandId: null,
	error: null,
	uncertain: false
})
interface Entry {
	owner: string
	snapshot: CommandSnapshot
	capsule: CommandCapsule | null
}

export class PendingCommandCoordinator {
	#owner: string | null
	#readOwner?: () => string | null
	#entries = new Map<string, Entry>()
	#listeners = new Set<() => void>()
	constructor(owner: string | null, readOwner?: () => string | null) {
		this.#owner = owner
		this.#readOwner = readOwner
	}
	subscribe = (notify: () => void) => {
		this.#listeners.add(notify)
		return () => {
			this.#listeners.delete(notify)
		}
	}
	#notify() {
		this.#listeners.forEach(notify => notify())
	}
	#key(scope: CommandScope, intent: string) {
		return JSON.stringify([scope.owner, scope.workspaceId, intent])
	}
	setOwner(owner: string | null) {
		if (owner === this.#owner) return
		this.#entries.forEach(entry => entry.capsule?.destroy())
		this.#entries.clear()
		this.#owner = owner
		this.#notify()
	}
	current(scope: CommandScope) {
		return (
			this.#owner === scope.owner &&
			(!this.#readOwner || this.#readOwner() === scope.owner)
		)
	}
	get(scope: CommandScope, intent: string): CommandSnapshot {
		return this.current(scope)
			? (this.#entries.get(this.#key(scope, intent))?.snapshot ?? idle)
			: idle
	}
	hasUnresolved = () =>
		[...this.#entries.values()].some(
			({ snapshot }) =>
				snapshot.status === 'running' ||
				snapshot.status === 'success' ||
				snapshot.uncertain
		)
	async run(
		scope: CommandScope,
		intent: string,
		authorize: () => Promise<string>,
		prepare?: () => CommandCapsule,
		mode: 'execute' | 'recover' = 'execute'
	) {
		if (!this.current(scope)) return
		const key = this.#key(scope, intent)
		let entry = this.#entries.get(key)
		if (entry?.snapshot.status === 'running') return
		// Recovery is opt-in and can only operate on the original private capsule.
		// It cannot substitute a new command body, UUID or another session's intent.
		if (mode === 'recover' && !entry?.capsule?.recover) return
		if (!entry && this.#entries.size >= 32)
			throw new AuthenticatedApiError(
				'temporary',
				'Сначала подтвердите ранее отправленные команды.'
			)
		if (!entry?.capsule && !prepare) return
		entry ??= { owner: scope.owner, snapshot: idle, capsule: null }
		this.#entries.set(key, entry)
		const active = entry
		active.snapshot = {
			...active.snapshot,
			status: 'running',
			uncertain:
				active.snapshot.uncertain || active.snapshot.status === 'success',
			error: null
		}
		this.#notify()
		let dispatched = false
		try {
			const token = await authorize()
			if (!this.current(scope) || this.#entries.get(key) !== active) return
			active.capsule ??= prepare!()
			active.snapshot = {
				...active.snapshot,
				commandId: active.capsule.commandId
			}
			dispatched = true
			if (mode === 'recover') await active.capsule.recover!(token)
			else await active.capsule.execute(token)
			if (!this.current(scope) || this.#entries.get(key) !== active) return
			active.snapshot = {
				...active.snapshot,
				status: 'success',
				uncertain: false
			}
		} catch (cause) {
			if (!this.current(scope) || this.#entries.get(key) !== active) return
			const error =
				cause instanceof AuthenticatedApiError
					? cause
					: new AuthenticatedApiError(
							'temporary',
							'Не удалось подтвердить результат. Повторите тот же запрос.'
						)
			const uncertain =
				active.snapshot.uncertain ||
				(dispatched && error.kind === 'temporary')
			if (!uncertain) {
				active.capsule?.destroy()
				active.capsule = null
			}
			active.snapshot = {
				...active.snapshot,
				uncertain,
				status: uncertain
					? error.kind === 'temporary'
						? 'unknown'
						: 'blocked'
					: 'rejected',
				error: { kind: error.kind, message: error.message }
			}
		} finally {
			if (this.current(scope) && this.#entries.get(key) === active)
				this.#notify()
		}
	}
	consume<C, R>(
		scope: CommandScope,
		intent: string,
		handler: (result: R, command: C) => void
	) {
		if (!this.current(scope)) return false
		const key = this.#key(scope, intent)
		const entry = this.#entries.get(key)
		if (entry?.snapshot.status !== 'success') return false
		this.#entries.delete(key)
		try {
			entry.capsule?.deliver((result, command) =>
				handler(result as R, command as C)
			)
		} finally {
			entry.capsule?.destroy()
			this.#notify()
		}
		return true
	}
	reset(scope: CommandScope, intent: string) {
		const snapshot = this.get(scope, intent)
		if (snapshot.status !== 'rejected') return false
		this.#entries.delete(this.#key(scope, intent))
		this.#notify()
		return true
	}
}
