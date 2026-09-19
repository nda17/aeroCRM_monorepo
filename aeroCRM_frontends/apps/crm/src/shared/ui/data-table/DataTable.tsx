import clsx from 'clsx'
import { useId } from 'react'
import type { Key, ReactNode } from 'react'

import styles from './DataTable.module.scss'

export type DataTableAlignment = 'left' | 'center' | 'right'
export type DataTableMobileLayout = 'table' | 'cards'

export interface DataTableColumn<T> {
	id: string
	header: ReactNode
	mobileLabel?: string
	render: (row: T, rowIndex: number) => ReactNode
	align?: DataTableAlignment
	headerClassName?: string
	cellClassName?: string
}

export interface DataTableProps<T> {
	caption: string
	columns: readonly DataTableColumn<T>[]
	rows: readonly T[]
	getRowKey: (row: T, rowIndex: number) => Key
	emptyMessage?: ReactNode
	embedded?: boolean
	mobileLayout?: DataTableMobileLayout
	rowClassName?:
		| string
		| ((row: T, rowIndex: number) => string | undefined)
	className?: string
}

const alignmentClassNames: Record<DataTableAlignment, string> = {
	left: styles.alignLeft,
	center: styles.alignCenter,
	right: styles.alignRight
}

export const DataTable = <T,>({
	caption,
	columns,
	rows,
	getRowKey,
	emptyMessage = 'Данных пока нет',
	embedded = false,
	mobileLayout = 'table',
	rowClassName,
	className
}: DataTableProps<T>) => {
	const tableId = useId()
	const useMobileCards = mobileLayout === 'cards'
	const headerId = (column: DataTableColumn<T>) =>
		useMobileCards ? `${tableId}-${column.id}` : undefined

	return (
		<div
			className={clsx(
				styles.wrapper,
				embedded && styles.embedded,
				useMobileCards && styles.cards,
				className
			)}
		>
			<div
				className={styles.scrollArea}
				role="region"
				aria-label={caption}
				tabIndex={0}
			>
				<table
					className={styles.table}
					role={useMobileCards ? 'table' : undefined}
				>
					<caption className={styles.caption}>{caption}</caption>
					<thead role={useMobileCards ? 'rowgroup' : undefined}>
						<tr
							className={styles.headerRow}
							role={useMobileCards ? 'row' : undefined}
						>
							{columns.map(column => (
								<th
									key={column.id}
									id={headerId(column)}
									role={useMobileCards ? 'columnheader' : undefined}
									scope="col"
									className={clsx(
										styles.headerCell,
										alignmentClassNames[column.align ?? 'left'],
										column.headerClassName
									)}
								>
									{column.header}
								</th>
							))}
						</tr>
					</thead>
					<tbody role={useMobileCards ? 'rowgroup' : undefined}>
						{rows.length ? (
							rows.map((row, rowIndex) => {
								const resolvedRowClassName =
									typeof rowClassName === 'function'
										? rowClassName(row, rowIndex)
										: rowClassName

								return (
									<tr
										key={getRowKey(row, rowIndex)}
										role={useMobileCards ? 'row' : undefined}
										className={clsx(styles.bodyRow, resolvedRowClassName)}
									>
										{columns.map(column => {
											const content = column.render(row, rowIndex)
											const mobileLabel =
												column.mobileLabel ??
												(typeof column.header === 'string'
													? column.header
													: undefined)

											return (
												<td
													key={column.id}
													role={useMobileCards ? 'cell' : undefined}
													headers={headerId(column)}
													className={clsx(
														styles.cell,
														alignmentClassNames[column.align ?? 'left'],
														column.cellClassName
													)}
												>
													{useMobileCards ? (
														<>
															{mobileLabel !== undefined ? (
																<span
																	className={styles.mobileLabel}
																	aria-hidden="true"
																>
																	{mobileLabel}
																</span>
															) : null}
															<div className={styles.cellContent}>
																{content}
															</div>
														</>
													) : (
														content
													)}
												</td>
											)
										})}
									</tr>
								)
							})
						) : (
							<tr
								className={styles.emptyRow}
								role={useMobileCards ? 'row' : undefined}
							>
								<td
									role={useMobileCards ? 'cell' : undefined}
									className={styles.emptyCell}
									colSpan={columns.length || 1}
								>
									{emptyMessage}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	)
}
