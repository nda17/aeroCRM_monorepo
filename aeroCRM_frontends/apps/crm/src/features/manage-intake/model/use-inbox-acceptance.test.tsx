import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getInboxAcceptance } from '@/entities/intake'
import { useInboxAcceptance } from './use-inbox-acceptance'
import type { IntakeAccess } from './use-intake-access'

const mocks = vi.hoisted(() => ({
	processingResult: null as unknown,
	command: {
		run: vi.fn(),
		retry: vi.fn(),
		running: false,
		uncertain: false,
		locked: false,
		error: undefined,
		resetError: vi.fn()
	}
}))

vi.mock('@/entities/intake', () => ({
	getInboxAcceptance: vi.fn(),
	isAcceptanceTerminal: (status: string) =>
		status === 'COMPLETED' || status === 'CANCELLED',
	mutateInboxAcceptance: vi.fn()
}))
vi.mock('./use-inbox-processing', () => ({
	useInboxProcessing: vi.fn(() => mocks.processingResult)
}))
vi.mock('./use-intake-command', () => ({
	useIntakeCommand: vi.fn(() => mocks.command)
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const entryId = '22222222-2222-4222-8222-222222222222'
const access = {
	workspaceId,
	session: { userId: 'current-staff', accessToken: 'token' },
	revision: 1,
	scopeKey: 'TEAM',
	canRead: true,
	sourceManager: false,
	canWrite: true,
	permissions: { data: { permissions: ['intake:accept'] } },
	online: true,
	authorize: vi.fn()
} as unknown as IntakeAccess
let client: QueryClient
const processing = (acceptance: unknown) => ({
	data: { items: [{ entryId, acceptance }] },
	isSuccess: true,
	isError: false,
	isFetching: false
})

const wrapper = ({ children }: PropsWithChildren) => (
	<QueryClientProvider client={client}>{children}</QueryClientProvider>
)

beforeEach(() => {
	vi.clearAllMocks()
	client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } }
	})
	mocks.processingResult = processing({
		actorSubject: 'another-staff',
		status: 'RUNNING',
		claimedAt: '2026-10-12T10:00:00.000Z'
	})
	mocks.command.error = undefined
	vi.mocked(getInboxAcceptance).mockResolvedValue({
		schemaVersion: 1,
		acceptance: {
			id: '33333333-3333-4333-8333-333333333333',
			workspaceId,
			entryId,
			actorSubject: 'current-staff',
			status: 'RUNNING'
		}
	} as never)
})
afterEach(cleanup)

describe('useInboxAcceptance shared processing boundary', () => {
	it('blocks an entry claimed by another employee before reading or accepting it', () => {
		const { result } = renderHook(
			() => useInboxAcceptance(access, entryId),
			{ wrapper }
		)
		expect(result.current.foreign).toBe(true)
		expect(result.current.row).toBeUndefined()
		expect(result.current.blocksEntry).toBe(true)
		expect(getInboxAcceptance).not.toHaveBeenCalled()
		expect(mocks.command.run).not.toHaveBeenCalled()
	})

	it('fails closed when the shared processing summary is unavailable', () => {
		mocks.processingResult = {
			data: undefined,
			isSuccess: false,
			isError: true,
			isFetching: false
		}
		const { result } = renderHook(
			() => useInboxAcceptance(access, entryId),
			{ wrapper }
		)
		expect(result.current.blocksEntry).toBe(true)
		expect(result.current.row).toBeUndefined()
		expect(getInboxAcceptance).not.toHaveBeenCalled()
		expect(mocks.command.run).not.toHaveBeenCalled()
	})

	it('keeps the current employee acceptance visible while processing is in flight', async () => {
		mocks.processingResult = processing({
			actorSubject: 'current-staff',
			status: 'RUNNING',
			claimedAt: '2026-10-12T10:00:00.000Z'
		})
		const { result } = renderHook(
			() => useInboxAcceptance(access, entryId),
			{ wrapper }
		)
		await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
		expect(result.current.foreign).toBe(false)
		expect(result.current.row?.actorSubject).toBe('current-staff')
		expect(result.current.blocksEntry).toBe(true)
		expect(getInboxAcceptance).toHaveBeenCalledOnce()
	})

	it('drops a previously visible row after a fresh processing summary names another claimant', async () => {
		mocks.processingResult = processing({
			actorSubject: 'current-staff',
			status: 'RUNNING',
			claimedAt: '2026-10-12T10:00:00.000Z'
		})
		const { result, rerender } = renderHook(
			() => useInboxAcceptance(access, entryId),
			{ wrapper }
		)
		await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
		expect(result.current.row?.actorSubject).toBe('current-staff')

		mocks.processingResult = processing({
			actorSubject: 'another-staff',
			status: 'RUNNING',
			claimedAt: '2026-10-12T10:01:00.000Z'
		})
		rerender()
		expect(result.current.foreign).toBe(true)
		expect(result.current.row).toBeUndefined()
		expect(result.current.blocksEntry).toBe(true)
	})
})
