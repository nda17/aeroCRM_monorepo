import AppIcon from '@/shared/ui/icons/AppIcon'
import type { HomePageCustomizationContent } from '@/entities/home-page-content'
import type { AppIconName } from '@/shared/types/icon.types'
import styles from './HomeCustomization.module.scss'

const CARD_ICONS: AppIconName[] = ['dashboard', 'edit', 'diamond', 'eye']
const FEATURE_ICONS: AppIconName[] = ['lock', 'settings', 'star']

interface Props {
	content: HomePageCustomizationContent
}

const renderLines = (text: string) =>
	text.split('\n').map((line, index, lines) => (
		<span key={`${line}-${index}`}>
			{line}
			{index < lines.length - 1 && <br />}
		</span>
	))

const HomeCustomization = ({ content }: Props) => {
	return (
		<section className={styles.section}>
			<div className={styles.inner}>
				<div className={styles.heading}>
					<h2 className={styles.title}>{renderLines(content.title)}</h2>
					<p className={styles.subtitle}>
						{renderLines(content.subtitle)}
					</p>
				</div>

				<div className={styles.cards}>
					{content.cards.map((card, index) => (
						<article
							key={`${card.title}-${index}`}
							className={styles.card}
						>
							<div className={styles.cardIcon}>
								<AppIcon
									name={CARD_ICONS[index % CARD_ICONS.length]}
									size={28}
								/>
							</div>
							<h3 className={styles.cardTitle}>{card.title}</h3>
							<p className={styles.cardText}>{renderLines(card.text)}</p>
						</article>
					))}
				</div>

				{content.features.length > 0 && (
					<div className={styles.featureBar}>
						{content.features.map((feature, index) => (
							<div
								key={`${feature.text}-${index}`}
								className={styles.featureItem}
							>
								<div className={styles.featureWrap}>
									<span className={styles.featureIcon}>
										<AppIcon
											name={FEATURE_ICONS[index % FEATURE_ICONS.length]}
											size={24}
										/>
									</span>
									<span>{renderLines(feature.text)}</span>
								</div>
							</div>
						))}
					</div>
				)}

				{content.bottomText && (
					<p className={styles.bottomText}>
						{renderLines(content.bottomText)}
					</p>
				)}
			</div>
		</section>
	)
}

export default HomeCustomization
