import { Button } from '@/shared/ui'
import styles from './MyDayScreen.module.scss'

export const WorkdayPagination = ({
	page,
	pageSize,
	total,
	pending,
	onPage,
	label
}: {
	page: number
	pageSize: number
	total: number
	pending: boolean
	onPage: (page: number) => void
	label: string
}) => (
	<nav className={styles.pagination} aria-label={label}>
		<span>
			Всего {total} · {page} / {Math.max(1, Math.ceil(total / pageSize))}
		</span>
		<div className={styles.viewSwitch}>
			<Button
				size="sm"
				variant="secondary"
				disabled={pending || page <= 1}
				onClick={() => onPage(page - 1)}
			>
				Назад
			</Button>
			<Button
				size="sm"
				variant="secondary"
				disabled={pending || page * pageSize >= total}
				onClick={() => onPage(page + 1)}
			>
				Далее
			</Button>
		</div>
	</nav>
)
