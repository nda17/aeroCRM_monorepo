import Link from '@/shared/lib/navigation/ZoneLink'
import styles from './HomeAffiliate.module.scss'

interface Props {
	cashbackPercent: number
}

const HomeAffiliate = ({ cashbackPercent }: Props) => {
	return (
		<section className={styles.section}>
			<div className={styles.inner}>
				<div className={styles.content}>
					<p className={styles.kicker}>Партнёрская программа</p>
					<h2 className={styles.title}>
						Рекомендуйте aeroCRM клиентам и получайте кэшбек
					</h2>
					<p className={styles.text}>
						Для дизайнеров, SMM-специалистов, директологов, специалистов по
						рекламе и агентств: если новый клиент зарегистрируется по вашей
						ссылке и оплатит первую подписку, вы сможете запросить{' '}
						{cashbackPercent}% от первого платежа за каждого приведенного
						клиента.
					</p>
				</div>
				<Link href="/register" className={styles.link}>
					Стать партнёром
				</Link>
			</div>
		</section>
	)
}

export default HomeAffiliate
