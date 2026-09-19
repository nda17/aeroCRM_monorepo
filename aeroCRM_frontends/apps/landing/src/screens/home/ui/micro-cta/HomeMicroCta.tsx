import HomeStartTrialLink from '@/screens/home/ui/_components/HomeStartTrialLink'
import AppIcon from '@/shared/ui/icons/AppIcon'
import type { HomePageMicroCtaContent } from '@/entities/home-page-content'
import styles from './HomeMicroCta.module.scss'

interface HomeMicroCtaProps {
	text: string
	buttonText: string
	content: HomePageMicroCtaContent
}

const HomeMicroCta = ({
	text,
	buttonText,
	content
}: HomeMicroCtaProps) => {
	if (!content.enabled || !text || !buttonText) return null

	return (
		<section className={styles.section}>
			<p className={styles.text}>{text}</p>
			<HomeStartTrialLink className={styles.button}>
				{buttonText}
				<AppIcon name="navigate-next" size={18} />
			</HomeStartTrialLink>
		</section>
	)
}

export default HomeMicroCta
