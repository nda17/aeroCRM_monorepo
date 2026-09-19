import styles from '@/app/styles/not-found.module.scss'
import { Metadata } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'

export const metadata: Metadata = {
	title: '404 — Страница не найдена',
	description: 'Запрашиваемая страница не существует'
}

const Error404 = () => {
	return (
		<div className={styles.wrapper}>
			<div className={styles.code}>404</div>
			<h1 className={styles.title}>Страница не найдена</h1>
			<p className={styles.description}>
				Возможно, страница была удалена или вы перешли по неверной ссылке
			</p>
			<Link href="/" className={styles.button}>
				На главную
			</Link>
		</div>
	)
}

export default Error404
