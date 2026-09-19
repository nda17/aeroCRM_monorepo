import type { HomePageAnalysisContent } from '@/entities/home-page-content'
import clsx from 'clsx'
import styles from './Analysis.module.scss'

const CARD_STYLES = [
	{
		num: 1,
		accent: '#e05a8a',
		border: 'linear-gradient(135deg, #f7a8c4, #e05a8a)',
		glow: 'radial-gradient(circle at top left, rgb(224 90 138 / 0.22), transparent 58%)',
		iconClass: 'cardFirst'
	},
	{
		num: 2,
		accent: '#3a8fd4',
		border: 'linear-gradient(135deg, #a8d4f7, #3a8fd4)',
		glow: 'radial-gradient(circle at top left, rgb(58 143 212 / 0.2), transparent 58%)',
		iconClass: 'cardSecond'
	},
	{
		num: 3,
		accent: '#2aab7a',
		border: 'linear-gradient(135deg, #a8f0d4, #2aab7a)',
		glow: 'radial-gradient(circle at top left, rgb(42 171 122 / 0.2), transparent 58%)',
		iconClass: 'cardThird'
	},
	{
		num: 4,
		accent: '#7b5ce5',
		border: 'linear-gradient(135deg, #c4b0f7, #7b5ce5)',
		glow: 'radial-gradient(circle at top left, rgb(123 92 229 / 0.2), transparent 58%)',
		iconClass: 'cardFour'
	}
]

interface Props {
	content: HomePageAnalysisContent
}

const Analysis = ({ content }: Props) => {
	return (
		<section className={styles.section}>
			<span className={styles.titleWrapper}>
				<h2 className={styles.title}>{content.title}</h2>
				<h3 className={styles.subtitle}>{content.subtitle}</h3>
			</span>

			<div className={styles.gridLayout}>
				{content.cards.map((card, index) => {
					const cardStyle = CARD_STYLES[index % CARD_STYLES.length]

					return (
						<div
							key={`${card.text}-${index}`}
							className={styles.card}
							style={
								{
									'--border-gradient': cardStyle.border,
									'--card-accent': cardStyle.accent,
									'--card-glow': cardStyle.glow
								} as React.CSSProperties
							}
						>
							<div className={styles.cardSurface}>
								<div className={styles.cardTop}>
									<div className={styles.iconShell}>
										<span
											className={clsx(
												styles.cardIcon,
												styles[cardStyle.iconClass as keyof typeof styles]
											)}
										></span>
									</div>
									<span className={styles.cardBadge}>
										Сценарий {String(index + 1).padStart(2, '0')}
									</span>
								</div>

								<p className={styles.text}>{card.text}</p>

								<span className={styles.num}>
									{String(index + 1).padStart(2, '0')}
								</span>
							</div>
						</div>
					)
				})}
			</div>
		</section>
	)
}

export default Analysis
