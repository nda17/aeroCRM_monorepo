export type DirtyFormEntry = {
	id: string
	label: string
	dirty: boolean
	scopes?: readonly string[]
}
type PendingDiscard = {
	action: () => void
	owner: string | null
	ids: readonly string[]
}

// Only metadata lives here. Field values stay inside their owning form.
export class DirtyFormCoordinator {
	private entries = new Map<string, DirtyFormEntry>()
	private listeners = new Set<() => void>()
	private pending: PendingDiscard | null = null
	private bypass = 0
	private revision = 0
	constructor(
		private owner: string | null,
		private readOwner?: () => string | null
	) {}
	readonly subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	readonly snapshot = () => this.revision
	private notify() {
		this.revision += 1
		this.listeners.forEach(listener => listener())
	}
	setOwner(owner: string | null) {
		if (this.owner === owner) return
		this.owner = owner
		this.entries.clear()
		this.pending = null
		this.notify()
	}
	private current() {
		if (this.readOwner) this.setOwner(this.readOwner())
		return this.owner !== null
	}
	update(entry: DirtyFormEntry) {
		if (!this.current()) return
		const previous = this.entries.get(entry.id)
		if (
			previous?.dirty === entry.dirty &&
			previous?.label === entry.label &&
			JSON.stringify(previous?.scopes) === JSON.stringify(entry.scopes)
		)
			return
		this.entries.set(entry.id, { ...entry })
		this.notify()
	}
	remove(id: string) {
		if (this.entries.delete(id)) {
			if (this.pending?.ids.includes(id)) this.pending = null
			this.notify()
		}
	}
	hasDirty(ids?: readonly string[]) {
		return (
			!this.bypass &&
			this.current() &&
			[...this.entries.values()].some(
				entry =>
					entry.dirty &&
					(!ids ||
						ids.includes(entry.id) ||
						entry.scopes?.some(scope => ids.includes(scope)))
			)
		)
	}
	isBypassing() {
		return this.bypass > 0
	}
	isConfirming() {
		return this.pending !== null
	}
	confirmDiscard(action: () => void, ids?: readonly string[]) {
		if (this.bypass || !this.hasDirty(ids)) {
			action()
			return
		}
		// Repeated Back/Escape/clicks must not replace the original intention.
		if (this.pending) return
		this.pending = {
			action,
			owner: this.owner,
			ids: [...this.entries.values()]
				.filter(
					entry =>
						entry.dirty &&
						(!ids ||
							ids.includes(entry.id) ||
							entry.scopes?.some(scope => ids.includes(scope)))
				)
				.map(entry => entry.id)
		}
		this.notify()
	}
	cancel() {
		this.pending = null
		this.notify()
	}
	discard() {
		if (!this.current()) return
		const pending = this.pending
		this.pending = null
		this.notify()
		if (!pending || pending.owner !== this.owner) return
		// Never touch pending commands or mark a surviving draft as saved.
		this.bypass += 1
		try {
			pending.action()
		} finally {
			this.bypass -= 1
		}
	}
}
