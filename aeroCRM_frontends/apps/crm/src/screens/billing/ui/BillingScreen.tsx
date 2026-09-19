'use client'

import {
	billingHref,
	parseBillingRoute,
	type BillingRoute
} from '@/entities/crm-billing'
import { useSessionStore } from '@/entities/session'
import { BillingFlow } from '@/features/manage-crm-billing'
import { ScreenState } from '@/shared/ui'
import { getRuntimeConfig } from '@/shared/config/runtime'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import styles from './BillingScreen.module.scss'

const BillingReturnRedirect = ({ route }: { route: BillingRoute }) => {
	const router = useRouter()
	useEffect(() => {
		const href = route.orderId
			? billingHref(route.workspaceId, { orderId: route.orderId })
			: null
		if (href) router.replace(href, { scroll: false })
	}, [route.workspaceId, route.orderId, router])
	return (
		<ScreenState
			variant="loading"
			title="Возвращаемся к проверке заказа"
			description="Возврат от провайдера не подтверждает оплату. Сейчас проверим прежний заказ через сервер aeroCRM."
		/>
	)
}

const BillingRouteScreen = ({ returning }: { returning: boolean }) => {
	const enabled = getRuntimeConfig().wincrmBillingEnabled
	const search = useSearchParams()
	const { session, sessionRevision } = useSessionStore()
	const route = parseBillingRoute(search, returning)
	return (
		<main className={styles.viewport}>
			<div className={styles.container}>
				<header className={styles.header}>
					<p className={styles.brand}>aeroCRM</p>
					<h1>Подписка и оплата</h1>
					<p>
						Условия рабочего пространства, оплаченные места и управление
						автопродлением — отдельно от Widgets.
					</p>
				</header>
				{!enabled ? (
					<ScreenState
						variant="empty"
						title="Оплата aeroCRM скоро будет доступна"
						description="Платёжные функции пока не выпущены. Здесь нельзя создать платёж или подключить автосписания; существующая подписка Widgets не изменяется."
					/>
				) : !route ? (
					<ScreenState
						variant="permission"
						title="Некорректная ссылка оплаты"
						description="Откройте оплату из настроек нужного рабочего пространства. Не удалось безопасно определить заказ; другое рабочее пространство не выбирается автоматически."
					/>
				) : returning ? (
					<BillingReturnRedirect route={route} />
				) : (
					<BillingFlow
						key={`${session?.userId}:${sessionRevision}:${route.workspaceId}`}
						route={route}
						onReference={reference => {
							const href = billingHref(route.workspaceId, reference)
							// Synchronous, bounded reference before dispatch: no JWT, PII, price,
							// consent text or command body enters browser persistence.
							if (href)
								window.history.replaceState(window.history.state, '', href)
						}}
					/>
				)}
			</div>
		</main>
	)
}

export const BillingScreen = ({
	returning = false
}: {
	returning?: boolean
}) => (
	<Suspense
		fallback={
			<ScreenState variant="loading" title="Открываем оплату aeroCRM" />
		}
	>
		<BillingRouteScreen returning={returning} />
	</Suspense>
)
