import AppIcon from '@/shared/ui/icons/AppIcon'
import styles from '@/shared/ui/pagination/Pagination.module.scss'
import { IPagination } from '@/shared/ui/pagination/paginate.interface'
import clsx from 'clsx'
import { NextPage } from 'next'

const Pagination: NextPage<IPagination> = ({
	listPage,
	currentPage,
	prevPage,
	nextPage,
	changeActivePage
}) => {
	const isFirstPage = currentPage === 1
	const isLastPage = currentPage === listPage.length

	return (
		<div className={styles.pagination}>
			<button
				type="button"
				className={styles.navButton}
				onClick={prevPage}
				disabled={isFirstPage}
				aria-label="Предыдущая страница"
			>
				<AppIcon name="navigate-before" size={18} />
			</button>
			<ul className={styles.pageList}>
				{listPage.map(page => (
					<li key={page}>
						<button
							type="button"
							className={clsx(styles.pageButton, {
								[styles.active]: page === currentPage
							})}
							aria-current={page === currentPage ? 'page' : undefined}
							aria-label={`Страница ${page}`}
							onClick={() => changeActivePage(page)}
						>
							{page}
						</button>
					</li>
				))}
			</ul>
			<button
				type="button"
				className={styles.navButton}
				onClick={nextPage}
				disabled={isLastPage}
				aria-label="Следующая страница"
			>
				<AppIcon name="navigate-next" size={18} />
			</button>
		</div>
	)
}

export default Pagination
