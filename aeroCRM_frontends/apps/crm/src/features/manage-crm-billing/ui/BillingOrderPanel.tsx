'use client'

import {
	getBillingOrder,
	isBillingConfirmationUrl,
	type BillingOrder
} from '@/entities/crm-billing'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { Button, ScreenState } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { useBillingContext } from '../model/use-billing-context'
import { useBillingActor } from '../model/use-billing-actor'
import {
	billingDate,
	billingFulfillmentLabel,
	billingMoney,
	billingOrderLabel
} from '../model/billing-display'
import styles from './BillingFlow.module.scss'

export const BillingOrderPanel = ({
	context,
	orderId,
	onRefreshContext,
	locked,
	navigationBusy,
	onVerify
}: {
	context: ReturnType<typeof useBillingContext>
	orderId: string
	onRefreshContext: () => void
	locked: boolean
	navigationBusy: boolean
	onVerify: (order: BillingOrder) => Promise<void>
}) => {
	const actor = useBillingActor(context.actor.workspaceId)
	const [attempts, setAttempts] = useState(0)
	const [opening, setOpening] = useState(false)
	const blankWindow = useRef<Window | null>(null)
	useEffect(
		() => () => {
			blankWindow.current?.close()
			blankWindow.current = null
		},
		[]
	)
	const order = useQuery({
		queryKey: ['crm-billing-order', ...actor.key, orderId],
		queryFn: async () => {
			const result = await getBillingOrder(
				actor.session!.accessToken,
				actor.workspaceId,
				orderId
			)
			if (!actor.current()) throw invalidContractError()
			return result
		},
		enabled: context.ready,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false
	})
	const pending =
		order.data?.order.state === 'PENDING' ||
		order.data?.order.state === 'UNKNOWN'
	useEffect(() => {
		if (
			!context.ready ||
			!pending ||
			order.isFetching ||
			order.isError ||
			attempts >= 10
		)
			return
		const timer = window.setTimeout(() => {
			if (!actor.current() || !navigator.onLine) return
			setAttempts(value => value + 1)
			void order.refetch()
		}, 3000)
		return () => window.clearTimeout(timer)
	}, [actor, attempts, context.ready, order, pending])
	const refresh = async () => {
		if (!actor.current() || !actor.online || order.isFetching) return
		const toastId = toast.loading('Пожалуйста, подождите')
		const result = await order.refetch()
		if (!actor.current()) {
			toast.dismiss(toastId)
			return
		}
		if (result.isError)
			toast.error(
				'Статус пока не подтверждён. Не создавайте повторный платёж.',
				{ id: toastId }
			)
		else {
			toast.success('Статус заказа обновлён', { id: toastId })
			onRefreshContext()
		}
	}
	const row =
		!order.isError && context.ready ? order.data?.order : undefined
	const openPayment = async () => {
		if (
			!row ||
			!context.ready ||
			navigationBusy ||
			opening ||
			!actor.current() ||
			!navigator.onLine
		)
			return
		const popup = window.open('about:blank', '_blank')
		if (!popup) {
			toast.error(
				'Разрешите открытие новой вкладки и повторите. Новый платёж не создаётся.'
			)
			return
		}
		popup.opener = null
		blankWindow.current = popup
		setOpening(true)
		try {
			const token = await context.authorize()
			if (!actor.current()) return
			const fresh = await getBillingOrder(
				token,
				actor.workspaceId,
				orderId
			)
			if (!actor.current()) return
			if (
				fresh.order.kind !== 'ONE_TIME' ||
				fresh.order.state !== 'PENDING' ||
				!isBillingConfirmationUrl(fresh.order.confirmationUrl) ||
				Date.parse(fresh.serverTime) >=
					Date.parse(fresh.order.checkoutExpiresAt)
			)
				throw invalidContractError()
			popup.location.replace(fresh.order.confirmationUrl)
			blankWindow.current = null
		} catch {
			if (actor.current())
				toast.error(
					'Безопасный переход к оплате сейчас не подтверждён. Обновите статус прежнего заказа.'
				)
		} finally {
			blankWindow.current?.close()
			blankWindow.current = null
			if (actor.current()) setOpening(false)
		}
	}
	return (
		<section
			className={`${styles.card} ${styles.orderCard}`}
			aria-label="Текущий заказ aeroCRM"
		>
			<div className={styles.sectionHeading}>
				<h2>Статус оплаты</h2>
				<Button
					size="sm"
					variant="secondary"
					tooltip="Обновить сохранённое на сервере состояние этого заказа"
					onClick={() => void refresh()}
					disabled={!context.ready}
					isLoading={order.isFetching}
				>
					Проверить статус оплаты
				</Button>
			</div>
			<p className={styles.note}>
				Возврат со страницы провайдера сам по себе не подтверждает оплату.
				Здесь проверяется только выбранный заказ этого рабочего
				пространства.
			</p>
			{order.isPending ? (
				<ScreenState variant="loading" title="Проверяем заказ" />
			) : !row ? (
				<p className={styles.error} role="alert">
					Не удалось подтвердить статус заказа. Это не означает отмену или
					отсутствие списания. Повторите проверку.
				</p>
			) : (
				<>
					<h3>{billingOrderLabel(row.state)}</h3>
					<dl className={styles.facts}>
						<div>
							<dt>Сумма</dt>
							<dd>{billingMoney(row.amountMinor)}</dd>
						</div>
						<div>
							<dt>Оплаченный период</dt>
							<dd>{billingFulfillmentLabel(row.fulfillment)}</dd>
						</div>
						{row.startsAt ? (
							<div>
								<dt>Начало периода</dt>
								<dd>{billingDate(row.startsAt)}</dd>
							</div>
						) : null}
						{row.expiresAt ? (
							<div>
								<dt>Окончание периода</dt>
								<dd>{billingDate(row.expiresAt)}</dd>
							</div>
						) : null}
					</dl>
					<div className={styles.actions}>
						{row.kind === 'ONE_TIME' &&
						row.state === 'PENDING' &&
						row.confirmationUrl &&
						isBillingConfirmationUrl(row.confirmationUrl) &&
						order.data &&
						Date.parse(order.data.serverTime) <
							Date.parse(row.checkoutExpiresAt) ? (
							<Button
								tooltip="Открыть страницу оплаты существующего заказа в YooKassa"
								disabled={
									navigationBusy || !actor.online || order.isFetching
								}
								isLoading={opening}
								onClick={() => void openPayment()}
							>
								Перейти к оплате в YooKassa
							</Button>
						) : null}
						{row.canVerify ? (
							<Button
								variant="secondary"
								tooltip="Проверить существующий платёж у YooKassa, не создавая новый заказ"
								disabled={
									locked || opening || order.isFetching || !context.ready
								}
								onClick={() => {
									toast(
										'Запрашиваем проверку существующего платежа у провайдера'
									)
									void onVerify(row)
								}}
							>
								Запросить проверку у провайдера
							</Button>
						) : null}
					</div>
					{row.state === 'UNKNOWN' ? (
						<p className={styles.notice}>
							Провайдер ещё не подтвердил окончательный результат. Не
							оплачивайте второй заказ вместо этого.
						</p>
					) : null}
					{row.fulfillment === 'SCHEDULED' ? (
						<p className={styles.note}>
							Оплата подтверждена, но оплаченный период ещё не начался.
							Бесплатный Trial сохраняется полностью.
						</p>
					) : null}
					{row.state === 'SUCCEEDED' ? (
						<p className={styles.note}>
							Допуск к разделам CRM проверяется отдельно при открытии
							рабочего пространства.
						</p>
					) : null}
				</>
			)}
			{attempts >= 10 && pending ? (
				<p className={styles.notice}>
					Автоматическая проверка приостановлена после 10 попыток.
					Проверить статус вручную можно в любой момент.
				</p>
			) : null}
		</section>
	)
}
