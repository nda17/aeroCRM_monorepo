import type { HomePageStepsContent } from '@/entities/home-page-content'
import clsx from 'clsx'
import styles from './HomeSteps.module.scss'

const STEP_STYLES = [
	{
		num: 1,
		accent: '#e05a8a',
		border: 'linear-gradient(135deg, #f7a8c4, #e05a8a)',
		glow: 'radial-gradient(circle at top left, rgb(224 90 138 / 0.22), transparent 58%)',
		iconClass: 'cardFirst'
	},
	{
		num: 2,
		accent: '#7b5ce5',
		border: 'linear-gradient(135deg, #c4b0f7, #7b5ce5)',
		glow: 'radial-gradient(circle at top left, rgb(123 92 229 / 0.22), transparent 58%)',
		iconClass: 'cardSecond'
	},
	{
		num: 3,
		accent: '#3a8fd4',
		border: 'linear-gradient(135deg, #a8d4f7, #3a8fd4)',
		glow: 'radial-gradient(circle at top left, rgb(58 143 212 / 0.2), transparent 58%)',
		iconClass: 'cardThird'
	}
]

interface Props {
	content: HomePageStepsContent
}

const HomeSteps = ({ content }: Props) => {
	return (
		<section className={styles.section}>
			<h2 className={styles.title}>{content.title}</h2>

			<div className={styles.gridLayout}>
				{content.items.map((step, index) => {
					const stepStyle = STEP_STYLES[index % STEP_STYLES.length]

					return (
						<div
							key={`${step.text}-${index}`}
							className={styles.card}
							style={
								{
									'--border-gradient': stepStyle.border,
									'--card-accent': stepStyle.accent,
									'--card-glow': stepStyle.glow
								} as React.CSSProperties
							}
						>
							<div className={styles.cardSurface}>
								<div className={styles.cardTop}>
									<div className={styles.iconShell}>
										<span
											className={clsx(
												styles.cardIcon,
												styles[stepStyle.iconClass as keyof typeof styles]
											)}
										></span>
									</div>
									<span className={styles.cardBadge}>
										Шаг {String(index + 1).padStart(2, '0')}
									</span>
								</div>

								<p className={styles.text}>{step.text}</p>

								<span className={styles.num}>
									{String(index + 1).padStart(2, '0')}
								</span>
							</div>
						</div>
					)
				})}

				<div className={styles.cardResult}>
					<div className={styles.resultInner}>
						<div className={styles.resultTop}>
							<span className={styles.resultBadge}>Результат</span>
							<span className={styles.iconHeart}></span>
						</div>
						<p className={styles.resultText}>
							{content.resultText.split('\n').map((line, index, lines) => (
								<span key={`${line}-${index}`}>
									{line}
									{index < lines.length - 1 && <br />}
								</span>
							))}
						</p>
					</div>
				</div>
			</div>
		</section>
	)
}

export default HomeSteps
