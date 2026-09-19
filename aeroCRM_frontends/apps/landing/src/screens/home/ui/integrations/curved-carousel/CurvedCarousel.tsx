'use client'

import type {
	HomePageIntegrationItem,
	HomePageIntegrationsContent
} from '@/entities/home-page-content'
import { type CSSProperties, type ReactNode } from 'react'
import styles from './CurvedCarousel.module.scss'

interface Slide {
	title: string
	description: string
	tag: string
	accent: string
	icon: ReactNode
}

type CardStyle = CSSProperties & {
	'--card-accent': string
	'--card-accent-soft': string
	'--card-accent-border': string
	'--card-accent-glow': string
	'--card-accent-highlight': string
	'--card-accent-sheen': string
}

const slides: Slide[] = [
	{
		title: 'CSV',
		tag: 'Импорт',
		description: 'Импорт обращений из файла CSV',
		accent: '#4f9cf9',
		icon: (
			<>
				<rect
					x="8"
					y="14"
					width="32"
					height="22"
					rx="3"
					stroke="currentColor"
					strokeWidth="1.8"
					fill="none"
				/>
				<path
					d="M8 17l16 11 16-11"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
			</>
		)
	},
	{
		title: 'API',
		tag: 'Источник',
		description: 'Приём обращений из своей системы',
		accent: '#29b6f6',
		icon: (
			<>
				<path
					d="M36 12 10 22l9 3.5 4 10 5-6.5 7 5L36 12Z"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					fill="none"
				/>
				<path
					d="M19 25.5l5 5"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
			</>
		)
	},
	{
		title: 'Tilda',
		tag: 'Формы сайта',
		description: 'Заявки из форм сайта во входящих CRM',
		accent: '#8f5fe8',
		icon: (
			<>
				<circle
					cx="24"
					cy="24"
					r="10"
					stroke="currentColor"
					strokeWidth="1.8"
					fill="none"
				/>
				<circle cx="24" cy="13" r="2.8" fill="currentColor" />
				<circle cx="24" cy="35" r="2.8" fill="currentColor" />
				<circle cx="13" cy="24" r="2.8" fill="currentColor" />
				<circle cx="35" cy="24" r="2.8" fill="currentColor" />
				<path
					d="M24 18v12M18 24h12"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					opacity="0.55"
				/>
			</>
		)
	},
]

const withAlpha = (hex: string, alpha: string) => `${hex}${alpha}`

const getCardStyle = (slide: Slide): CardStyle => ({
	'--card-accent': slide.accent,
	'--card-accent-soft': withAlpha(slide.accent, '2e'),
	'--card-accent-border': withAlpha(slide.accent, '82'),
	'--card-accent-glow': withAlpha(slide.accent, '36'),
	'--card-accent-highlight': withAlpha(slide.accent, '1f'),
	'--card-accent-sheen': withAlpha(slide.accent, '14')
})

const renderCards = (
	items: HomePageIntegrationItem[],
	isDuplicate = false
) =>
	items.map((slide, index) => {
		const visual = slides[index % slides.length]

		return (
			<article
				key={`${isDuplicate ? 'copy' : 'main'}-${slide.title}-${index}`}
				className={styles.card}
				style={getCardStyle(visual)}
				aria-hidden={isDuplicate}
			>
				<div className={styles.cardHeader}>
					<div className={styles.iconWrap}>
						<svg
							width="28"
							height="28"
							viewBox="0 0 48 48"
							fill="none"
							color="currentColor"
						>
							{visual.icon}
						</svg>
					</div>
					<span className={styles.tag}>{slide.tag}</span>
				</div>
				<div className={styles.copy}>
					<h3 className={styles.title}>{slide.title}</h3>
					<p className={styles.description}>{slide.description}</p>
				</div>
				<div className={styles.cardFooter}>
					<span className={styles.status}>
						<span className={styles.statusDot} />
						<span>Источник обращений</span>
					</span>
				</div>
			</article>
		)
	})

interface Props {
	content: HomePageIntegrationsContent
}

export default function CurvedCarousel({ content }: Props) {
	return (
		<section
			className={styles.section}
			aria-labelledby="integrations-title"
		>
			<div className={styles.heading}>
				<h2 id="integrations-title" className={styles.headingTitle}>
					{content.title}
				</h2>
			</div>

			<div className={styles.viewport}>
				<div className={styles.track}>
					<div className={styles.group}>{renderCards(content.items)}</div>
					<div
						className={`${styles.group} ${styles.groupDuplicate}`}
						aria-hidden="true"
					>
						{renderCards(content.items, true)}
					</div>
				</div>
			</div>
		</section>
	)
}
