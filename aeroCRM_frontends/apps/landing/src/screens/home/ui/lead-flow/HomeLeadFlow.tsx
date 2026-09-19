import HomeSectionHeader from '@/screens/home/ui/_components/HomeSectionHeader'
import type { HomePageLeadFlowContent } from '@/entities/home-page-content'
import styles from './HomeLeadFlow.module.scss'

interface HomeLeadFlowProps {
	content: HomePageLeadFlowContent
}

const HomeLeadFlow = ({ content }: HomeLeadFlowProps) => {
	if (!content.enabled) return null

	return (
		<section className={styles.section}>
			<HomeSectionHeader
				title={content.title}
				subtitle={content.subtitle}
			/>
			<div className={styles.flowGrid}>
				{content.items.map((item, index) => (
					<article key={`${item.title}-${index}`} className={styles.item}>
						<span className={styles.num}>
							{String(index + 1).padStart(2, '0')}
						</span>
						<h3 className={styles.title}>{item.title}</h3>
						<p className={styles.text}>{item.text}</p>
					</article>
				))}
			</div>
		</section>
	)
}

export default HomeLeadFlow
