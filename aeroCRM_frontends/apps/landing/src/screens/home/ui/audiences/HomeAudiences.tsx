import HomeSectionHeader from '@/screens/home/ui/_components/HomeSectionHeader'
import AppIcon from '@/shared/ui/icons/AppIcon'
import type { HomePageAudiencesContent } from '@/entities/home-page-content'
import type { AppIconName } from '@/shared/types/icon.types'
import styles from './HomeAudiences.module.scss'

const CARD_ICONS: AppIconName[] = [
	'dashboard',
	'star',
	'diamond',
	'settings',
	'payment',
	'lock'
]

interface HomeAudiencesProps {
	content: HomePageAudiencesContent
}

const HomeAudiences = ({ content }: HomeAudiencesProps) => {
	if (!content.enabled) return null

	return (
		<section className={styles.section}>
			<HomeSectionHeader
				title={content.title}
				subtitle={content.subtitle}
			/>
			<div className={styles.cardsGrid}>
				{content.items.map((item, index) => (
					<article key={`${item.title}-${index}`} className={styles.card}>
						<span className={styles.icon}>
							<AppIcon
								name={CARD_ICONS[index % CARD_ICONS.length]}
								size={24}
							/>
						</span>
						<h3 className={styles.cardTitle}>{item.title}</h3>
						<p className={styles.cardText}>{item.text}</p>
					</article>
				))}
			</div>
		</section>
	)
}

export default HomeAudiences
