import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedView } from '@/entities/crm-saved-views'
import { SavedViewsControl } from './SavedViewsControl'

const state = vi.hoisted(() => ({
	onSaved: undefined as
		| ((result: unknown, command: { mutation: { kind: string } }) => void)
		| undefined,
	canManage: false,
	items: [] as SavedView[],
	querySuccess: false,
	execute: vi.fn()
}))
vi.mock('../model/use-saved-views', () => ({
	useSavedViews: (
		_context: unknown,
		_scope: unknown,
		onSaved: typeof state.onSaved
	) => {
		state.onSaved = onSaved
		return {
			canManage: state.canManage,
			items: state.items,
			query: {
				isSuccess: state.querySuccess,
				isPending: !state.querySuccess,
				isError: false,
				refetch: vi.fn()
			},
			command: {
				locked: false,
				running: false,
				uncertain: false,
				blocked: false,
				error: null,
				snapshot: { status: 'idle' },
				execute: state.execute,
				reset: vi.fn()
			}
		}
	}
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const date = '2026-10-01T10:00:00.000Z'
const parameters = {
	search: '',
	pipelineId: '',
	status: '',
	withoutNextAction: false,
	layout: 'list' as const,
	sort: 'created_desc' as const
}
const item: SavedView = {
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	subject: 'actor',
	scope: 'DEALS',
	name: 'Мои сделки',
	parameters,
	version: 1,
	legacyKey: null,
	archivedAt: null,
	createdAt: date,
	updatedAt: date
}
const context = {
	workspace: { workspaceId, canWrite: true },
	session: { userId: 'actor', accessToken: 'token' },
	sessionRevision: 1,
	permissions: { isFetching: false, data: { state: 'ACTIVE' } },
	canRead: true,
	scopeKey: 'owner',
	key: [workspaceId, 'actor', 1, 'owner']
} as never
const renderControl = (
	props: Partial<Parameters<typeof SavedViewsControl>[0]> = {}
) =>
	render(
		<SavedViewsControl
			context={context}
			scope="DEALS"
			parameters={parameters}
			onOpen={vi.fn()}
			{...props}
		/>
	)

beforeEach(() => {
	state.onSaved = undefined
	state.canManage = false
	state.items = []
	state.querySuccess = false
	state.execute.mockReset()
})
afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('saved views control', () => {
	it('allows opening personal views while keeping CRUD hidden in read-only mode', () => {
		state.items = [item]
		state.querySuccess = true
		const onOpen = vi.fn()
		renderControl({ onOpen })
		fireEvent.click(screen.getByRole('button', { name: 'Мои сделки' }))
		expect(onOpen).toHaveBeenCalledWith(parameters)
		expect(screen.queryByText('Удалить представление')).toBeNull()
		expect(screen.queryByText('Переименовать «Мои сделки»')).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Сохранить вид' })
		).toBeNull()
	})

	it('clears the legacy source only after the import command reports success', async () => {
		state.canManage = true
		vi.stubGlobal('crypto', {
			subtle: {
				digest: vi.fn(async () => new Uint8Array(32).buffer)
			}
		})
		const legacy = [{ id: 'legacy-1', name: 'Старый вид', parameters }]
		const onImported = vi.fn()
		renderControl({ legacy, onImported })
		fireEvent.click(screen.getByRole('button', { name: 'Перенести' }))
		await waitFor(() => expect(state.execute).toHaveBeenCalledTimes(1))
		expect(state.execute).toHaveBeenCalledWith({
			kind: 'import',
			views: [
				{
					legacyKey: '0'.repeat(64),
					name: 'Старый вид',
					parameters
				}
			]
		})
		expect(onImported).not.toHaveBeenCalled()
		expect(screen.getByText(/ещё не перенесены в CRM/)).toBeTruthy()

		state.onSaved?.({ schemaVersion: 1 }, { mutation: { kind: 'import' } })
		expect(onImported).toHaveBeenCalledOnce()
	})
})
