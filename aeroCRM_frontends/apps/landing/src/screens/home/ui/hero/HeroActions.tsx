'use client'

import HomeStartTrialLink from '@/screens/home/ui/_components/HomeStartTrialLink'
import type { HomePageHeroContent } from '@/entities/home-page-content'
import styles from './HeroSection.module.scss'

interface Props {
	content: Pick<
		HomePageHeroContent,
		'primaryButtonText' | 'faqButtonLabel' | 'benefits'
	>
}

const HeroActions = ({ content }: Props) => {
	const scrollToFaq = () => {
		document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' })
	}

	return (
		<div className={styles.buttons}>
			<HomeStartTrialLink className={styles.buttonLink}>
				{content.primaryButtonText}
				<span className={styles.arrowBtn}></span>
			</HomeStartTrialLink>
			{content.benefits.length > 0 && (
				<ul className={styles.heroBenefits} aria-label="Преимущества">
					{content.benefits.map((benefit, index) => (
						<li key={`${benefit.text}-${index}`}>
							<span aria-hidden="true">✓</span>
							{benefit.text}
						</li>
					))}
				</ul>
			)}
			<button
				className={styles.buttonArrow}
				type="button"
				onClick={scrollToFaq}
				aria-label={content.faqButtonLabel}
			/>
		</div>
	)
}

export default HeroActions
