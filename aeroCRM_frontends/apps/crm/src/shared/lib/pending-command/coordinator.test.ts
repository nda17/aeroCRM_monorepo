import { describe, expect, it, vi } from 'vitest'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { commandCapsule, PendingCommandCoordinator } from './coordinator'

const scope = { owner: 'user:1', workspaceId: 'workspace' }
const authorize = async () => 'access-token'
const temporary = () => new AuthenticatedApiError('temporary', 'Unknown')
describe('document-local pending command coordinator', () => {
	it('checks the live auth owner before React has committed the new session boundary', async () => {
		let owner: string | null = scope.owner
		const store = new PendingCommandCoordinator(owner, () => owner)
		let finish!: () => void
		const send = vi.fn(
			() =>
				new Promise<void>(resolve => {
					finish = resolve
				})
		)
		const pending = store.run(scope, 'new', authorize, () =>
			commandCapsule({ commandId: 'old' }, send)
		)
		await Promise.resolve()
		owner = null
		finish()
		await pending
		expect(store.get(scope, 'new').status).toBe('idle')
		expect(store.consume(scope, 'new', vi.fn())).toBe(false)
		store.setOwner(null)
		expect(store.hasUnresolved()).toBe(false)
	})
	it('reuses an immutable private capsule after observer unmount and never exposes a secret in snapshots', async () => {
		const store = new PendingCommandCoordinator(scope.owner)
		const send = vi
			.fn()
			.mockRejectedValueOnce(temporary())
			.mockResolvedValueOnce({ id: 'saved' })
		const input = {
			commandId: 'stable',
			token: 'private-source-token',
			fields: { name: 'original' }
		}
		await store.run(scope, 'source:new', authorize, () =>
			commandCapsule(input, send)
		)
		input.fields.name = 'changed'
		expect(JSON.stringify(store.get(scope, 'source:new'))).not.toContain(
			input.token
		)
		expect(store.hasUnresolved()).toBe(true)
		await store.run(scope, 'source:new', authorize)
		expect(send.mock.calls[1][1]).toBe(send.mock.calls[0][1])
		expect(send.mock.calls[1][1].fields.name).toBe('original')
		const consume = vi.fn()
		expect(store.consume(scope, 'source:new', consume)).toBe(true)
		expect(store.consume(scope, 'source:new', consume)).toBe(false)
		expect(consume).toHaveBeenCalledTimes(1)
	})
	it.each(['unauthorized', 'forbidden', 'conflict', 'notFound'] as const)(
		'retains UNKNOWN across a later %s instead of permitting a new UUID',
		async kind => {
			const store = new PendingCommandCoordinator(scope.owner)
			const send = vi
				.fn()
				.mockRejectedValueOnce(temporary())
				.mockRejectedValueOnce(new AuthenticatedApiError(kind, 'Blocked'))
				.mockResolvedValueOnce({})
			const prepare = vi.fn(() =>
				commandCapsule({ commandId: 'original' }, send)
			)
			await store.run(scope, 'create', authorize, prepare)
			await store.run(scope, 'create', authorize, prepare)
			expect(store.get(scope, 'create')).toMatchObject({
				status: 'blocked',
				uncertain: true,
				commandId: 'original'
			})
			expect(store.reset(scope, 'create')).toBe(false)
			await store.run(scope, 'create', authorize, prepare)
			expect(prepare).toHaveBeenCalledTimes(1)
		}
	)
	it('owns the execution lock across remounts and rejects foreign tenant/session consumption', async () => {
		const store = new PendingCommandCoordinator(scope.owner)
		let finish!: () => void
		const send = vi.fn(
			() =>
				new Promise<void>(resolve => {
					finish = resolve
				})
		)
		const running = store.run(scope, 'create', authorize, () =>
			commandCapsule({ commandId: 'one' }, send)
		)
		await Promise.resolve()
		await store.run(scope, 'create', authorize)
		expect(send).toHaveBeenCalledTimes(1)
		expect(
			store.get({ ...scope, workspaceId: 'other' }, 'create').status
		).toBe('idle')
		store.setOwner('user:2')
		finish()
		await running
		expect(store.get(scope, 'create').status).toBe('idle')
		expect(store.consume(scope, 'create', vi.fn())).toBe(false)
	})
	it('does not dispatch when the auth boundary changes during authorization', async () => {
		const store = new PendingCommandCoordinator(scope.owner)
		let finish!: (token: string) => void
		const send = vi.fn()
		const prepare = vi.fn(() => commandCapsule({ commandId: 'one' }, send))
		const pending = store.run(
			scope,
			'create',
			() =>
				new Promise(resolve => {
					finish = resolve
				}),
			prepare
		)
		store.setOwner(null)
		finish('old-token')
		await pending
		expect(prepare).not.toHaveBeenCalled()
	})
	it('allows review after a definite initial rejection, but not during a request', async () => {
		const store = new PendingCommandCoordinator(scope.owner)
		await store.run(scope, 'create', authorize, () =>
			commandCapsule(
				{ commandId: 'one' },
				vi
					.fn()
					.mockRejectedValue(
						new AuthenticatedApiError('validation', 'Invalid')
					)
			)
		)
		expect(store.get(scope, 'create')).toMatchObject({
			status: 'rejected',
			uncertain: false
		})
		expect(store.reset(scope, 'create')).toBe(true)
	})
})
