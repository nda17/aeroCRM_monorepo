import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import type { WorkdayFilters as Filters } from '@/entities/crm-workday'
import { initialWorkdayFilters } from '../model/workday-view'
import { WorkdayFilters } from './WorkdayFilters'

vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn()
	})
}))
afterEach(cleanup)
const setup = (view: 'list' | 'board' = 'list') => {
	const onChange = vi.fn()
	const onViewChange = vi.fn()
	render(
		<WorkdayFilters
			value={initialWorkdayFilters()}
			allowedScopes={['MINE']}
			view={view}
			onChange={onChange}
			onViewChange={onViewChange}
		/>
	)
	return { onChange, onViewChange }
}
describe('MyDay filters', () => {
	it('quick overdue view preserves ACTIVE with current scope and timezone', () => {
		const onChange = vi.fn()
		render(
			<WorkdayFilters
				value={{
					...initialWorkdayFilters(),
					scope: 'TEAM',
					timeZone: 'Asia/Vladivostok',
					status: 'COMPLETED',
					page: 3
				}}
				allowedScopes={['MINE', 'TEAM']}
				view="list"
				onChange={onChange}
				onViewChange={vi.fn()}
			/>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Просроченные' }))
		expect(onChange).toHaveBeenCalledWith({
			...initialWorkdayFilters(),
			scope: 'TEAM',
			timeZone: 'Asia/Vladivostok',
			period: 'OVERDUE',
			status: 'ACTIVE',
			from: undefined,
			to: undefined
		})
	})
	it('quick overdue on the board clears the list-only ACTIVE filter', () => {
		const onChange = vi.fn()
		render(
			<WorkdayFilters
				value={initialWorkdayFilters()}
				allowedScopes={['MINE']}
				view="board"
				onChange={onChange}
				onViewChange={vi.fn()}
			/>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Просроченные' }))
		expect(onChange).toHaveBeenCalledWith({
			...initialWorkdayFilters(),
			period: 'OVERDUE',
			status: undefined,
			from: undefined,
			to: undefined
		})
	})
	it('does not announce success for ordinary period, filter, or view changes', () => {
		const onChange = vi.fn()
		const onViewChange = vi.fn()
		render(
			<WorkdayFilters
				value={initialWorkdayFilters()}
				allowedScopes={['MINE']}
				view="list"
				onChange={onChange}
				onViewChange={onViewChange}
			/>
		)
		fireEvent.change(screen.getByLabelText('Поиск по задаче'), {
			target: { value: 'Встреча' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		fireEvent.click(screen.getByRole('button', { name: 'Неделя' }))
		fireEvent.click(screen.getByRole('button', { name: 'Доска' }))
		fireEvent.click(screen.getByRole('button', { name: 'Список' }))
		expect(onChange).toHaveBeenCalledTimes(2)
		expect(onViewChange).toHaveBeenCalledTimes(2)
		expect(toast.success).not.toHaveBeenCalled()
		expect(toast).not.toHaveBeenCalled()
	})
	it('exposes only permitted scopes and applies search on submit', () => {
		const { onChange } = setup()
		expect(screen.getByLabelText('Поиск по задаче')).toBeTruthy()
		expect(
			(
				screen
					.getByLabelText('Часовой пояс')
					.closest('details') as HTMLDetailsElement
			).open
		).toBe(false)
		expect(
			(
				screen
					.getByLabelText('Статус')
					.closest('details') as HTMLDetailsElement
			).open
		).toBe(false)
		fireEvent.click(screen.getByText('Дополнительные фильтры'))
		expect(
			screen.queryByRole('option', { name: 'Вся команда' })
		).toBeNull()
		fireEvent.change(screen.getByLabelText('Поиск по задаче'), {
			target: { value: '  Встреча  ' }
		})
		expect(onChange).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(onChange).toHaveBeenCalledWith({
			...initialWorkdayFilters(),
			search: 'Встреча'
		})
	})
	it('removes one active filter chip while preserving the remaining filters', () => {
		const onChange = vi.fn()
		const value = {
			...initialWorkdayFilters(),
			period: 'WEEK' as const,
			scope: 'TEAM' as const,
			search: 'звонок',
			status: 'ACTIVE' as const,
			page: 4
		} as Filters
		render(
			<WorkdayFilters
				value={value}
				allowedScopes={['MINE', 'TEAM']}
				view="list"
				onChange={onChange}
				onViewChange={vi.fn()}
			/>
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Снять фильтр: Поиск: звонок' })
		)
		expect(onChange).toHaveBeenCalledWith({
			...value,
			search: undefined,
			page: 1
		})
		expect(toast).not.toHaveBeenCalled()
	})
	it('resets active filter chips to the allowed default scope and all periods', () => {
		const onChange = vi.fn()
		const value = {
			...initialWorkdayFilters(),
			period: 'WEEK' as const,
			scope: 'TEAM' as const,
			search: 'звонок',
			status: 'ACTIVE' as const
		} as Filters
		render(
			<WorkdayFilters
				value={value}
				allowedScopes={['MINE', 'TEAM']}
				view="list"
				onChange={onChange}
				onViewChange={vi.fn()}
			/>
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Сбросить фильтры' })
		)
		expect(onChange).toHaveBeenCalledWith({
			period: 'ALL',
			scope: 'MINE',
			timeZone: value.timeZone,
			page: 1,
			pageSize: value.pageSize
		})
		expect(toast).not.toHaveBeenCalled()
	})
	it('requires explicit dates before querying a range and includes its end date', () => {
		const { onChange } = setup()
		fireEvent.change(screen.getByLabelText('Период'), {
			target: { value: 'RANGE' }
		})
		expect(
			(
				screen.getByRole('button', {
					name: 'Применить'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
		fireEvent.change(screen.getByLabelText(/^С даты/), {
			target: { value: '2026-09-01' }
		})
		fireEvent.change(screen.getByLabelText(/^По дату включительно/), {
			target: { value: '2026-09-08' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(onChange).toHaveBeenCalledWith({
			...initialWorkdayFilters(),
			period: 'RANGE',
			from: '2026-09-01',
			to: '2026-09-08'
		})
	})
	it('cannot select an unknown timezone and leaves the valid filter unchanged', () => {
		const { onChange } = setup()
		fireEvent.click(screen.getByText('Дополнительные фильтры'))
		fireEvent.change(screen.getByLabelText('Часовой пояс'), {
			target: { value: 'unknown' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(onChange).toHaveBeenCalledWith(initialWorkdayFilters())
		expect(screen.getByLabelText('Часовой пояс')).toHaveProperty(
			'value',
			'Europe/Moscow'
		)
		expect(screen.queryByRole('alert')).toBeNull()
	})
	it('changes timezone only on apply, preserving the existing date/filter contract', () => {
		const { onChange } = setup()
		fireEvent.click(screen.getByText('Дополнительные фильтры'))
		fireEvent.change(screen.getByLabelText('Часовой пояс'), {
			target: { value: 'Asia/Vladivostok' }
		})
		expect(onChange).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
		expect(onChange).toHaveBeenCalledWith({
			...initialWorkdayFilters(),
			timeZone: 'Asia/Vladivostok'
		})
	})
	it('board offers an accessible view switch, without cancelled-status column filter', () => {
		const { onViewChange } = setup('board')
		expect(screen.queryByLabelText('Статус')).toBeNull()
		expect(
			screen
				.getByRole('button', { name: 'Доска' })
				.getAttribute('aria-pressed')
		).toBe('true')
		fireEvent.click(screen.getByRole('button', { name: 'Список' }))
		expect(onViewChange).toHaveBeenCalledWith('list')
	})
})
