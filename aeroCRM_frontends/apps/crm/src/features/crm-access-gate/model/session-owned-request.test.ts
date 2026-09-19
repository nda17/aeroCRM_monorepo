import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/entities/session'
import { sessionOwnedRequest } from './session-owned-request'

const session = { userId: 'actor', accessToken: 'opaque-token' }
beforeEach(() =>
	useSessionStore.setState({
		status: 'authenticated',
		session,
		sessionRevision: 1
	})
)
describe('Trial/onboarding request owner', () => {
	it.each([
		{ session: { ...session, userId: 'other' } },
		{ session: { ...session, accessToken: 'rotated-token' } },
		{ sessionRevision: 2 },
		{ status: 'anonymous' as const, session: null }
	])(
		'rejects an independently changed user, token, revision or status before dispatch',
		async change => {
			const send = vi.fn()
			const request = sessionOwnedRequest(
				session,
				1,
				{ commandId: 'one' },
				send
			)
			useSessionStore.setState(change)
			expect(request.isCurrent()).toBe(false)
			await expect(request.execute()).rejects.toMatchObject({
				kind: 'unauthorized'
			})
			expect(send).not.toHaveBeenCalled()
			expect(JSON.stringify(request)).not.toContain(session.accessToken)
		}
	)
})
