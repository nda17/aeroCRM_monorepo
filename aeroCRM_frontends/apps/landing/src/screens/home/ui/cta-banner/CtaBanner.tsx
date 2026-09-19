import HomeStartTrialLink from '@/screens/home/ui/_components/HomeStartTrialLink'
import AppIcon from '@/shared/ui/icons/AppIcon'
import type { HomePageCtaContent } from '@/entities/home-page-content'
import type { AppIconName } from '@/shared/types/icon.types'
import styles from './CtaBanner.module.scss'

interface Props {
	content: HomePageCtaContent
}

const BENEFIT_ICONS: AppIconName[] = ['lock', 'clock', 'refresh']

const CtaBanner = ({ content }: Props) => {
	return (
		<section className={styles.section}>
			<div className={styles.inner}>
				<p className={styles.text}>
					{content.text.split('\n').map((line, index, lines) => (
						<span key={`${line}-${index}`}>
							{line}
							{index < lines.length - 1 && <br />}
						</span>
					))}
				</p>
				<HomeStartTrialLink className={styles.button}>
					{content.buttonText}
					<span className={styles.arrow}>
						<svg
							width="20"
							height="20"
							viewBox="0 0 20 20"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M4.5 10H15.5M15.5 10L10.5 5M15.5 10L10.5 15"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</span>
				</HomeStartTrialLink>
				{content.benefits.length > 0 && (
					<div className={styles.benefits}>
						{content.benefits.map((benefit, index) => (
							<div
								key={`${benefit.text}-${index}`}
								className={styles.benefit}
							>
								<span className={styles.benefitIcon}>
									<AppIcon
										name={BENEFIT_ICONS[index % BENEFIT_ICONS.length]}
										size={22}
									/>
								</span>
								<span className={styles.benefitText}>
									{benefit.text
										.split('\n')
										.map((line, lineIndex, lines) => (
											<span key={`${line}-${lineIndex}`}>
												{line}
												{lineIndex < lines.length - 1 && <br />}
											</span>
										))}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</section>
	)
}

export default CtaBanner
