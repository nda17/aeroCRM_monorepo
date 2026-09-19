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
		title: 'Email',
		tag: 'Уведомления',
		description:
			'Мгновенное письмо с именем, призом и страницей при каждой заявке',
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
		title: 'Telegram',
		tag: 'Мессенджер',
		description:
			'Уведомления прямо в чат — быстрее почты, всегда под рукой',
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
		title: 'Webhook',
		tag: 'Интеграция',
		description:
			'POST-запрос с данными лида — подключите Make, Zapier или n8n',
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
	{
		title: 'Битрикс24',
		tag: 'CRM',
		description:
			'Лид с именем, телефоном и страницей создаётся автоматически',
		accent: '#f47a3c',
		icon: (
			<>
				<rect
					x="10"
					y="20"
					width="10"
					height="16"
					rx="2.5"
					stroke="currentColor"
					strokeWidth="1.8"
					fill="none"
				/>
				<rect
					x="24"
					y="12"
					width="10"
					height="24"
					rx="2.5"
					stroke="currentColor"
					strokeWidth="1.8"
					fill="none"
				/>
				<path
					d="M15 20v-4"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
				<circle cx="15" cy="13.5" r="2.5" fill="currentColor" />
			</>
		)
	},
	{
		title: 'amoCRM',
		tag: 'CRM',
		description:
			'Новая сделка и контакт без ручного ввода при каждой заявке',
		accent: '#5bc8ff',
		icon: (
			<>
				<path
					d="M13 28a11 11 0 1 1 21.4-4.8"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					fill="none"
				/>
				<path
					d="M30 13l5 4.5-5 4.5"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<circle cx="24" cy="24" r="3.5" fill="currentColor" />
			</>
		)
	},
	{
		title: 'Яндекс Метрика',
		tag: 'Аналитика',
		description:
			'Цели ip3_open и ip3_send — воронка от клика до заявки у вас в счётчике',
		accent: '#ff5252',
		icon: (
			<>
				<polyline
					points="10,34 17,22 22,28 28,16 36,34"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					fill="none"
				/>
				<circle cx="36" cy="34" r="2.5" fill="currentColor" />
				<circle cx="10" cy="34" r="2.5" fill="currentColor" />
			</>
		)
	},
	{
		title: 'VK Ретаргетинг',
		tag: 'Реклама',
		description:
			'Аудитория для ретаргетинга ВКонтакте — показывайте рекламу тем, кто крутил',
		accent: '#6e9ef5',
		icon: (
			<>
				<path
					d="M10 24c0-7.7 6.3-14 14-14s14 6.3 14 14c0 3.2-1.1 6.2-3 8.5C33 35 29 37 24 37s-9-2-11-4.5a14 14 0 0 1-3-8.5Z"
					stroke="currentColor"
					strokeWidth="1.8"
					fill="none"
				/>
				<circle
					cx="24"
					cy="22"
					r="4"
					stroke="currentColor"
					strokeWidth="1.8"
					fill="none"
				/>
				<path
					d="M14.5 33.5a10 10 0 0 1 19 0"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					fill="none"
					opacity="0.55"
				/>
			</>
		)
	},
	{
		title: 'Roistat',
		tag: 'Аналитика',
		description:
			'Видите ROI каждого канала — события передаются без дополнительных настроек',
		accent: '#4caf7d',
		icon: (
			<>
				<path
					d="M12 34V26M18 34V20M24 34V24M30 34V16M36 34V20"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
				<path
					d="M12 26l6-6 6 4 6-8 6 4"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</>
		)
	}
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
						<span>Готово к подключению</span>
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
