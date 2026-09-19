import clsx from 'clsx'
import { useId } from 'react'
import type { Key, ReactNode } from 'react'

import styles from './KanbanBoard.module.scss'

export interface KanbanColumn<T> {
	id: string
	title: ReactNode
	items: readonly T[]
	meta?: ReactNode
}

export interface KanbanBoardProps<T> {
	ariaLabel: string
	columns: readonly KanbanColumn<T>[]
	getItemKey: (item: T, column: KanbanColumn<T>, itemIndex: number) => Key
	renderItem: (
		item: T,
		column: KanbanColumn<T>,
		itemIndex: number
	) => ReactNode
	emptyColumnMessage?: ReactNode
	className?: string
}

export const KanbanBoard = <T,>({
	ariaLabel,
	columns,
	getItemKey,
	renderItem,
	emptyColumnMessage = 'В этой колонке пока ничего нет',
	className
}: KanbanBoardProps<T>) => {
	const boardId = useId()

	return (
		<div
			className={clsx(styles.board, className)}
			role="region"
			aria-label={ariaLabel}
			tabIndex={0}
		>
			<div className={styles.columns}>
				{columns.map((column, columnIndex) => {
					const titleId = `${boardId}-column-${columnIndex}`

					return (
						<section
							key={column.id}
							className={styles.column}
							aria-labelledby={titleId}
						>
							<header className={styles.columnHeader}>
								<h2 id={titleId} className={styles.columnTitle}>
									{column.title}
								</h2>
								<div className={styles.columnMeta}>
									{column.meta ?? column.items.length}
								</div>
							</header>
							<ul className={styles.cardList}>
								{column.items.length ? (
									column.items.map((item, itemIndex) => (
										<li
											key={getItemKey(item, column, itemIndex)}
											className={styles.cardItem}
										>
											{renderItem(item, column, itemIndex)}
										</li>
									))
								) : (
									<li className={styles.emptyColumn}>
										{emptyColumnMessage}
									</li>
								)}
							</ul>
						</section>
					)
				})}
			</div>
		</div>
	)
}
