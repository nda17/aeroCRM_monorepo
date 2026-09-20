'use client'

import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import type { HomePagePricingContent } from '@/entities/home-page-content'
import type { CrmPricingPolicy } from '@/entities/crm-pricing'
import { useAuthStore } from '@/entities/user'
import Link from '@/shared/lib/navigation/ZoneLink'
import { useState } from 'react'
import styles from './HomePricing.module.scss'

type BillingPeriod = 'monthly' | 'yearly'

interface Props {
	content: HomePagePricingContent
	crmPricingPolicy?: CrmPricingPolicy | null
}

const formatRub = (minor: number) =>
	new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(minor / 100)

const HomePricing = ({ content, crmPricingPolicy }: Props) => {
	const [billing, setBilling] = useState<BillingPeriod>('monthly')
	const auth = useAuthStore(state => state.auth)
	const ctaHref = auth ? PUBLIC_PAGES.PAYMENT : PUBLIC_PAGES.REGISTER
	const price = crmPricingPolicy
		? billing === 'yearly'
			? crmPricingPolicy.yearlyPriceMinor
			: crmPricingPolicy.monthlyPriceMinor
		: null

	return (
		<section id="pricing" className={styles.section}>
			<h2 className={styles.title}>Тариф aeroCRM</h2>
			<div className={styles.toggle}>
				<button className={`${styles.toggleBtn} ${billing === 'monthly' ? styles.toggleBtnActive : ''}`} onClick={() => setBilling('monthly')} type="button">{content.monthlyToggleText}</button>
				<button className={`${styles.toggleBtn} ${billing === 'yearly' ? styles.toggleBtnActive : ''}`} onClick={() => setBilling('yearly')} type="button">{content.yearlyToggleText}<span className={styles.toggleDiscount}>−10%</span></button>
			</div>
			<div className={styles.gridLayout}>
				<div className={`${styles.card} ${styles.cardPopular}`}>
					<div className={styles.cardInner}>
						<div>
							<p className={styles.subtitle}>Клиенты и продажи в одном месте</p>
							<h3 className={styles.planTitle}>aeroCRM</h3>
							<ul className={styles.features}>
							<li>Входящие обращения, клиенты и сделки</li>
							<li>Задачи, командная работа и отчёты</li>
							<li>{crmPricingPolicy ? `${crmPricingPolicy.includedSeats} места включены` : 'Места команды включены'}</li>
							<li>{crmPricingPolicy ? `${crmPricingPolicy.trialDays} дней пробного периода` : 'Пробный период'}</li>
						</ul>
						</div>
						<div className={styles.bottom}>
							<div className={styles.priceWrap}><span className={styles.price}>{price === null ? 'Цена уточняется' : formatRub(price)}</span><span className={styles.priceNote}>{billing === 'yearly' ? 'в год' : 'в месяц'}</span></div>
							<Link href={ctaHref} className={styles.btn}>Попробовать aeroCRM</Link>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}

export default HomePricing
