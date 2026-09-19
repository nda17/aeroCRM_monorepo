import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listTeamOptions } from '../api/team.api'
import { useTeamOptions } from '../model/use-team-options'
import { TeamSelect } from './TeamSelect'
import type { TeamOptionsPage } from '../model/team-options.contract'

vi.mock('../api/team.api', () => ({ listTeamOptions: vi.fn() }))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const otherWorkspace = '33333333-3333-4333-8333-333333333333'
const ids = Array.from(
	{ length: 21 },
	(_, index) =>
		`22222222-2222-4222-8222-${String(index).padStart(12, '0')}`
)
const items = ids.map((id, index) => ({ id, name: `Отдел ${index + 1}` }))
let client: QueryClient
const changed = vi.fn()
const Harness = ({
	workspace = workspaceId,
	subject = 'owner',
	enabled = true,
	teamIds = ids,
	disabled = false
}: {
	workspace?: string
	subject?: string
	enabled?: boolean
	teamIds?: string[]
	disabled?: boolean
}) => {
	const [value, setValue] = useState('')
	const options = useTeamOptions(
		{
			workspaceId: workspace,
			subject,
			accessToken: 'test-session-token',
			sessionRevision: 1,
			permissionScope: subject,
			teamIds,
			enabled
		},
		value
	)
	return (
		<>
			<TeamSelect
				options={options}
				value={value}
				disabled={disabled}
				onChange={id => {
					changed(id)
					setValue(id)
				}}
			/>
			<button disabled={!options.validSelection}>Создать</button>
		</>
	)
}
const view = (props: Parameters<typeof Harness>[0] = {}) => (
	<QueryClientProvider client={client}>
		<Harness {...props} />
	</QueryClientProvider>
)
beforeEach(() => {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	vi.clearAllMocks()
	vi.mocked(listTeamOptions).mockImplementation(
		async (_token, request) => ({
			schemaVersion: 1,
			workspaceId: request.workspaceId,
			subject: request.subject,
			page: request.page,
			pageSize: request.pageSize,
			total: items.length,
			items: items.slice(
				(request.page - 1) * request.pageSize,
				request.page * request.pageSize
			),
			selected: items.find(item => item.id === request.selectedId) ?? null
		})
	)
})
afterEach(() => {
	cleanup()
	client.clear()
})
describe('shared department selector', () => {
	it('shows names, stores UUID and preserves selected name across server pages', async () => {
		render(view())
		await screen.findByRole('option', { name: 'Отдел 1' })
		fireEvent.change(screen.getByRole('combobox'), {
			target: { value: ids[0] }
		})
		await waitFor(() =>
			expect(
				(
					screen.getByRole('button', {
						name: 'Создать'
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		)
		expect(changed).toHaveBeenLastCalledWith(ids[0])
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		await screen.findByRole('option', { name: 'Отдел 21' })
		expect(screen.getByRole('option', { name: 'Отдел 1' })).toBeTruthy()
		expect(screen.queryByRole('option', { name: 'Отдел 2' })).toBeNull()
		expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
			ids[0]
		)
		expect(document.body.textContent).not.toContain(ids[0])
		expect(listTeamOptions).toHaveBeenLastCalledWith(
			'test-session-token',
			expect.objectContaining({
				page: 2,
				pageSize: 20,
				selectedId: ids[0]
			})
		)
	})
	it('hides old names on access revocation and never clears the selection silently', async () => {
		const rendered = render(view())
		await screen.findByRole('option', { name: 'Отдел 1' })
		fireEvent.change(screen.getByRole('combobox'), {
			target: { value: ids[0] }
		})
		await waitFor(() =>
			expect(
				(
					screen.getByRole('button', {
						name: 'Создать'
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		)
		rendered.rerender(view({ enabled: false, teamIds: [] }))
		expect(screen.queryByRole('option', { name: 'Отдел 1' })).toBeNull()
		expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
			ids[0]
		)
		expect(
			(
				screen.getByRole('button', {
					name: 'Создать'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
		expect(changed).toHaveBeenCalledTimes(1)
	})
	it('does not render late data after workspace or actor switches', async () => {
		let resolve!: (data: TeamOptionsPage) => void
		vi.mocked(listTeamOptions).mockReturnValueOnce(
			new Promise(done => {
				resolve = done
			})
		)
		const rendered = render(view())
		expect(screen.getByText('Загружаем отделы…')).toBeTruthy()
		rendered.rerender(
			view({ workspace: otherWorkspace, subject: 'other', enabled: false })
		)
		await act(async () =>
			resolve({
				schemaVersion: 1,
				workspaceId,
				subject: 'owner',
				page: 1,
				pageSize: 20,
				total: 1,
				items: [items[0]],
				selected: null
			})
		)
		expect(screen.queryByRole('option', { name: 'Отдел 1' })).toBeNull()
		expect(listTeamOptions).toHaveBeenCalledTimes(1)
	})
	it('shows a recoverable error without raw IDs or automatic reassignment', async () => {
		vi.mocked(listTeamOptions).mockRejectedValueOnce(
			new Error('temporary')
		)
		render(view())
		await screen.findByText(
			'Не удалось загрузить отделы. Выбор не изменён.'
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Повторить загрузку отделов' })
		)
		await screen.findByRole('option', { name: 'Отдел 1' })
		expect(changed).not.toHaveBeenCalled()
	})
	it('supports empty names list and disabled read-only controls', async () => {
		vi.mocked(listTeamOptions).mockResolvedValueOnce({
			schemaVersion: 1,
			workspaceId,
			subject: 'owner',
			page: 1,
			pageSize: 20,
			total: 0,
			items: [],
			selected: null
		})
		render(view({ disabled: true }))
		await screen.findByText('Доступных отделов пока нет.')
		expect(
			(screen.getByRole('combobox') as HTMLSelectElement).disabled
		).toBe(true)
		expect(screen.queryByRole('navigation')).toBeNull()
	})
	it('uses product-neutral notifications when selecting and clearing a department', async () => {
		render(view())
		await screen.findByRole('option', { name: 'Отдел 1' })
		fireEvent.change(screen.getByRole('combobox'), {
			target: { value: ids[0] }
		})
		expect(toast).toHaveBeenLastCalledWith('Отдел выбран')
		await waitFor(() =>
			expect(
				(screen.getByRole('combobox') as HTMLSelectElement).disabled
			).toBe(false)
		)
		fireEvent.change(screen.getByRole('combobox'), {
			target: { value: '' }
		})
		expect(toast).toHaveBeenLastCalledWith('Без отдела')
	})
})
