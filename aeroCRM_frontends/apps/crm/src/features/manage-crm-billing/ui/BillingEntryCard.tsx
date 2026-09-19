'use client'

import { billingHref } from '@/entities/crm-billing'
import { Button } from '@/shared/ui'
import { getRuntimeConfig } from '@/shared/config/runtime'
import toast from 'react-hot-toast'
import { useBillingContext } from '../model/use-billing-context'
import styles from './BillingFlow.module.scss'

const BillingEntryCardEnabled = ({
	workspaceId
}: {
	workspaceId: string
}) => {
	const context = useBillingContext(workspaceId)
	const href = billingHref(workspaceId)
	return (
		<section
			className={styles.card}
			aria-label="Управление подпиской aeroCRM"
		>
			<div className={styles.sectionHeading}>
				<h2>Подписка и оплата aeroCRM</h2>
			</div>
			<p className={styles.note}>
				Управление оплатой доступно владельцу и при доступе только для
				чтения. Настройки подписки Widgets не меняются.
			</p>
			{context.ready && href ? (
				<a
					className={styles.link}
					href={href}
					onClick={() => toast('Открываем управление подпиской aeroCRM')}
				>
					Открыть подписку и оплату
				</a>
			) : (
				<>
					<p className={styles.note}>
						{context.query.isFetching
							? 'Подтверждаем актуальные права владельца…'
							: 'Не удалось подтвердить доступ к оплате. Настройки команды остаются доступны независимо.'}
					</p>
					<Button
						variant="secondary"
						size="sm"
						tooltip="Повторно проверить права владельца и доступ к управлению подпиской aeroCRM"
						disabled={!context.actor.online || context.query.isFetching}
						onClick={async () => {
							toast('Проверяем доступ к оплате')
							const result = await context.query.refetch()
							if (context.actor.current()) {
								if (result.isError)
									toast.error('Доступ к оплате пока не подтверждён')
								else toast.success('Доступ к оплате подтверждён')
							}
						}}
					>
						Проверить доступ к оплате
					</Button>
				</>
			)}
		</section>
	)
}

export const BillingEntryCard = ({
	workspaceId
}: {
	workspaceId: string
}) =>
	getRuntimeConfig().wincrmBillingEnabled ? (
		<BillingEntryCardEnabled workspaceId={workspaceId} />
	) : (
		<section className={styles.card}>
			<h2>Оплата aeroCRM скоро будет доступна</h2>
			<p className={styles.note}>
				Платёжные действия пока не выпущены. Подписка Widgets не
				изменяется.
			</p>
		</section>
	)
