import {
	cleanup,
	fireEvent,
	render,
	screen,
	within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataTable, type DataTableColumn } from './DataTable'
import styles from './DataTable.module.scss'

afterEach(cleanup)

const rows = [
	{ id: 'first', name: 'Анна', amount: 1500 },
	{ id: 'second', name: 'Иван', amount: 2000 }
]
type RecordRow = (typeof rows)[number]
const columns: DataTableColumn<RecordRow>[] = [
	{ id: 'name', header: 'Клиент', render: row => row.name },
	{
		id: 'amount',
		header: 'Сумма',
		align: 'right',
		render: row => row.amount
	}
]
const getRowKey = (row: RecordRow) => row.id

describe('DataTable optional mobile cards', () => {
	it('preserves the default table without adding card labels or cell wrappers', () => {
		const { container } = render(
			<DataTable
				caption="Клиенты"
				columns={columns}
				rows={rows}
				getRowKey={getRowKey}
			/>
		)
		const table = screen.getByRole('table', { name: 'Клиенты' })
		expect(table.getAttribute('role')).toBeNull()
		expect(within(table).getAllByRole('row')).toHaveLength(3)
		expect(within(table).getAllByRole('cell')).toHaveLength(4)
		expect(container.querySelector(`.${styles.cards}`)).toBeNull()
		expect(container.querySelector(`.${styles.mobileLabel}`)).toBeNull()
		expect(container.querySelector(`.${styles.cellContent}`)).toBeNull()
		expect(
			screen
				.getByRole('cell', { name: '1500' })
				.classList.contains(styles.alignRight)
		).toBe(true)
	})

	it('retains table, row and column relationships when card styles change display', () => {
		const { container } = render(
			<DataTable
				caption="Клиенты"
				columns={columns}
				rows={rows}
				getRowKey={getRowKey}
				mobileLayout="cards"
			/>
		)
		const table = screen.getByRole('table', { name: 'Клиенты' })
		expect(table.getAttribute('role')).toBe('table')
		const groups = within(table).getAllByRole('rowgroup')
		expect(groups).toHaveLength(2)
		expect(
			groups.every(group => group.getAttribute('role') === 'rowgroup')
		).toBe(true)
		expect(
			within(table)
				.getAllByRole('row')
				.every(row => row.getAttribute('role') === 'row')
		).toBe(true)
		const headers = within(table).getAllByRole('columnheader')
		expect(headers.map(header => header.textContent)).toEqual([
			'Клиент',
			'Сумма'
		])
		expect(
			headers.every(header => header.getAttribute('scope') === 'col')
		).toBe(true)
		const cells = within(table).getAllByRole('cell')
		expect(cells).toHaveLength(4)
		for (const [index, cell] of cells.entries()) {
			expect(cell.getAttribute('role')).toBe('cell')
			expect(cell.getAttribute('headers')).toBe(
				headers[index % columns.length].id
			)
		}
		expect(
			container.querySelectorAll(`.${styles.mobileLabel}`)
		).toHaveLength(4)
		expect(screen.getByRole('cell', { name: 'Анна' })).toBe(cells[0])
		expect(screen.queryByRole('cell', { name: 'Клиент Анна' })).toBeNull()
		for (const label of container.querySelectorAll(
			`.${styles.mobileLabel}`
		)) {
			expect(label.getAttribute('aria-hidden')).toBe('true')
		}
	})

	it('renders each record control once instead of cloning desktop and mobile trees', () => {
		const onAction = vi.fn()
		const renderName = vi.fn((row: RecordRow) => (
			<label>
				Заметка {row.name}
				<input aria-label={`Заметка ${row.name}`} />
			</label>
		))
		const renderAction = vi.fn((row: RecordRow) => (
			<button onClick={() => onAction(row.id)}>Открыть {row.name}</button>
		))
		render(
			<DataTable
				caption="Действия"
				columns={[
					{ id: 'name', header: 'Заметка', render: renderName },
					{ id: 'action', header: 'Действие', render: renderAction }
				]}
				rows={rows}
				getRowKey={getRowKey}
				mobileLayout="cards"
			/>
		)
		expect(renderName).toHaveBeenCalledTimes(rows.length)
		expect(renderAction).toHaveBeenCalledTimes(rows.length)
		expect(screen.getAllByRole('textbox')).toHaveLength(rows.length)
		expect(screen.getAllByRole('button')).toHaveLength(rows.length)
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Заметка Анна' }),
			{ target: { value: 'Перезвонить' } }
		)
		expect(
			(
				screen.getByRole('textbox', {
					name: 'Заметка Анна'
				}) as HTMLInputElement
			).value
		).toBe('Перезвонить')
		fireEvent.click(screen.getByRole('button', { name: 'Открыть Анна' }))
		expect(onAction).toHaveBeenCalledExactlyOnceWith('first')
	})

	it('uses explicit text labels for rich headers and never clones header controls into rows', () => {
		const { container } = render(
			<DataTable
				caption="Подписи"
				columns={[
					{
						id: 'name',
						header: <button>Сортировать по имени</button>,
						mobileLabel: 'Имя клиента',
						render: row => row.name
					},
					{
						id: 'amount',
						header: <strong>Сумма заказа</strong>,
						render: row => row.amount
					}
				]}
				rows={rows.slice(0, 1)}
				getRowKey={getRowKey}
				mobileLayout="cards"
			/>
		)
		expect(
			screen.getAllByRole('button', { name: 'Сортировать по имени' })
		).toHaveLength(1)
		const labels = container.querySelectorAll(`.${styles.mobileLabel}`)
		expect(labels).toHaveLength(1)
		expect(labels[0].textContent).toBe('Имя клиента')
		expect(labels[0].getAttribute('aria-hidden')).toBe('true')
	})

	it('keeps alignment, custom classes, row keys and embedded styling available on desktop', () => {
		const { container } = render(
			<DataTable
				caption="Стили"
				columns={[
					{
						...columns[0],
						headerClassName: 'custom-header',
						cellClassName: 'custom-cell'
					},
					columns[1]
				]}
				rows={rows}
				getRowKey={getRowKey}
				mobileLayout="cards"
				embedded
				className="custom-table"
				rowClassName={row => `record-${row.id}`}
			/>
		)
		expect(container.querySelectorAll('.custom-table')).toHaveLength(1)
		expect(container.querySelectorAll(`.${styles.embedded}`)).toHaveLength(
			1
		)
		expect(container.querySelectorAll('.custom-header')).toHaveLength(1)
		expect(container.querySelectorAll('.custom-cell')).toHaveLength(
			rows.length
		)
		expect(container.querySelectorAll('.record-first')).toHaveLength(1)
		expect(
			screen
				.getByRole('cell', { name: '1500' })
				.classList.contains(styles.alignRight)
		).toBe(true)
	})

	it('keeps an empty result as one readable cell instead of a fake card', () => {
		const { container } = render(
			<DataTable
				caption="Пустые клиенты"
				columns={columns}
				rows={[]}
				getRowKey={getRowKey}
				mobileLayout="cards"
				emptyMessage="Ничего не найдено"
			/>
		)
		const cells = screen.getAllByRole('cell')
		expect(cells).toHaveLength(1)
		expect(cells[0].textContent).toBe('Ничего не найдено')
		expect(cells[0].getAttribute('colspan')).toBe('2')
		expect(container.querySelector(`.${styles.mobileLabel}`)).toBeNull()
		expect(container.querySelector(`.${styles.bodyRow}`)).toBeNull()
	})
})
