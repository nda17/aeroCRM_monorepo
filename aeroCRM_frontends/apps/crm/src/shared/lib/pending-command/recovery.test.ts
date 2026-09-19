import { describe, expect, it, vi } from 'vitest'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { commandCapsule, PendingCommandCoordinator } from './coordinator'

const scope = { owner: 'owner:1', workspaceId: 'workspace' }
const authorize = vi.fn(async () => 'synthetic-token')
const unknown = () => new AuthenticatedApiError('temporary', 'Unknown')

describe('optional opaque command recovery', () => {
	it('recovers the original capsule after remount without exposing or replacing its body', async () => {
		const coordinator = new PendingCommandCoordinator(scope.owner)
		const original = {
			commandId: 'original',
			consent: 'exact-version',
			fields: { totalSeats: 2 }
		}
		const send = vi.fn().mockRejectedValue(unknown())
		const recover = vi.fn().mockResolvedValue({ state: 'COMMITTED' })
		await coordinator.run(scope, 'billing', authorize, () =>
			commandCapsule(original, send, recover)
		)
		original.fields.totalSeats = 999
		const replaced = vi.fn(() =>
			commandCapsule({ commandId: 'replacement' }, send)
		)
		await coordinator.run(scope, 'billing', authorize, replaced, 'recover')
		expect(replaced).not.toHaveBeenCalled()
		expect(recover).toHaveBeenCalledWith('synthetic-token', {
			commandId: 'original',
			consent: 'exact-version',
			fields: { totalSeats: 2 }
		})
		expect(send).toHaveBeenCalledTimes(1)
		expect(
			JSON.stringify(coordinator.get(scope, 'billing'))
		).not.toContain('exact-version')
		const consume = vi.fn()
		expect(coordinator.consume(scope, 'billing', consume)).toBe(true)
		expect(consume).toHaveBeenCalledWith(
			{ state: 'COMMITTED' },
			{
				commandId: 'original',
				consent: 'exact-version',
				fields: { totalSeats: 2 }
			}
		)
		expect(coordinator.hasUnresolved()).toBe(false)
	})
	it('does not add recovery behavior to existing commands or create a new capsule', async () => {
		const coordinator = new PendingCommandCoordinator(scope.owner)
		const send = vi.fn().mockRejectedValue(unknown())
		const prepare = vi.fn(() => commandCapsule({ commandId: 'new' }, send))
		await coordinator.run(scope, 'empty', authorize, prepare, 'recover')
		expect(prepare).not.toHaveBeenCalled()
		await coordinator.run(scope, 'legacy', authorize, prepare)
		await coordinator.run(scope, 'legacy', authorize, undefined, 'recover')
		expect(send).toHaveBeenCalledTimes(1)
		expect(coordinator.get(scope, 'legacy').uncertain).toBe(true)
	})
	it.each([
		'temporary',
		'unauthorized',
		'forbidden',
		'conflict',
		'notFound'
	] as const)(
		'keeps an unknown command unresolved after recovery %s',
		async kind => {
			const coordinator = new PendingCommandCoordinator(scope.owner)
			await coordinator.run(scope, 'billing', authorize, () =>
				commandCapsule(
					{ commandId: 'original' },
					vi.fn().mockRejectedValue(unknown()),
					vi
						.fn()
						.mockRejectedValue(
							new AuthenticatedApiError(kind, 'Not confirmed')
						)
				)
			)
			await coordinator.run(
				scope,
				'billing',
				authorize,
				undefined,
				'recover'
			)
			expect(coordinator.get(scope, 'billing')).toMatchObject({
				uncertain: true,
				commandId: 'original'
			})
			expect(coordinator.reset(scope, 'billing')).toBe(false)
		}
	)
	it('suppresses recovery dispatch after a session change during fresh authorization', async () => {
		const coordinator = new PendingCommandCoordinator(scope.owner)
		const recover = vi.fn()
		await coordinator.run(scope, 'billing', authorize, () =>
			commandCapsule(
				{ commandId: 'original' },
				vi.fn().mockRejectedValue(unknown()),
				recover
			)
		)
		let finish!: (token: string) => void
		const pending = coordinator.run(
			scope,
			'billing',
			() =>
				new Promise(resolve => {
					finish = resolve
				}),
			undefined,
			'recover'
		)
		coordinator.setOwner('owner:2')
		finish('old-token')
		await pending
		expect(recover).not.toHaveBeenCalled()
		expect(coordinator.hasUnresolved()).toBe(false)
	})
	it('does not deliver a late recovery response to a new session or another workspace', async () => {
		const coordinator = new PendingCommandCoordinator(scope.owner)
		let finish!: (value: unknown) => void
		const recover = vi.fn(
			() =>
				new Promise(resolve => {
					finish = resolve
				})
		)
		await coordinator.run(scope, 'billing', authorize, () =>
			commandCapsule(
				{ commandId: 'original' },
				vi.fn().mockRejectedValue(unknown()),
				recover
			)
		)
		await coordinator.run(
			{ ...scope, workspaceId: 'foreign' },
			'billing',
			authorize,
			undefined,
			'recover'
		)
		expect(recover).not.toHaveBeenCalled()
		const pending = coordinator.run(
			scope,
			'billing',
			authorize,
			undefined,
			'recover'
		)
		await Promise.resolve()
		coordinator.setOwner('owner:2')
		finish({ state: 'COMMITTED' })
		await pending
		expect(coordinator.consume(scope, 'billing', vi.fn())).toBe(false)
	})
})
