import type { HomePageSeoTextContent } from '@/entities/home-page-content'
import styles from './HomeSeoText.module.scss'

interface HomeSeoTextProps {
	content: HomePageSeoTextContent
}

const HomeSeoText = ({ content }: HomeSeoTextProps) => {
	if (!content.enabled) return null

	return (
		<section className={styles.section}>
			<h2 className={styles.title}>{content.title}</h2>
			<p className={styles.text}>{content.text}</p>
		</section>
	)
}

export default HomeSeoText
