import HomeSectionHeader from '@/screens/home/ui/_components/HomeSectionHeader'
import type { HomePageDashboardPreviewContent } from '@/entities/home-page-content'
import styles from './HomeDashboardPreview.module.scss'

interface HomeDashboardPreviewProps {
	content: HomePageDashboardPreviewContent
}

const HomeDashboardPreview = ({ content }: HomeDashboardPreviewProps) => {
	if (!content.enabled) return null

	return (
		<section className={styles.section}>
			<div className={styles.layout}>
				<div>
					<HomeSectionHeader
						title={content.title}
						subtitle={content.subtitle}
						align="left"
					/>
					<div className={styles.cards}>
						{content.cards.map((card, index) => (
							<article
								key={`${card.title}-${index}`}
								className={styles.card}
							>
								<h3 className={styles.cardTitle}>{card.title}</h3>
								<p className={styles.cardText}>{card.text}</p>
							</article>
						))}
					</div>
				</div>
				<div className={styles.mock} aria-hidden="true">
					<div className={styles.mockTop}>
						<span />
						<span />
						<span />
					</div>
					<div className={styles.mockStats}>
						{content.metrics.map((metric, index) => (
							<div
								key={`${metric.title}-${index}`}
								className={styles.mockStat}
							>
								<strong>{metric.title}</strong>
								<span>{metric.text}</span>
							</div>
						))}
					</div>
					<div className={styles.mockTable}>
						<span />
						<span />
						<span />
						<span />
					</div>
				</div>
			</div>
		</section>
	)
}

export default HomeDashboardPreview
