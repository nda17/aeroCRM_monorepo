'use client'

import {
	getBillingQuote,
	type BillingContext,
	type BillingCycle,
	type BillingMutation,
	type BillingQuote,
	type BillingQuoteRequest
} from '@/entities/crm-billing'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { Button, SelectField, TextField } from '@/shared/ui'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { useBillingContext } from '../model/use-billing-context'
import { BillingQuotePreview } from './BillingQuotePreview'
import styles from './BillingFlow.module.scss'

const minimumSeats = (
	intent: BillingQuoteRequest['intent'],
	data: BillingContext
) =>
	Math.max(
		2,
		intent === 'SEAT_CHANGE' && data.billing.period
			? data.billing.period.priceSnapshot.includedSeats
			: data.billing.policy.includedSeats,
		data.capacity.usedSeats
	)

export const BillingComposer = ({
	context,
	data,
	intent,
	locked,
	onSubmit
}: {
	context: ReturnType<typeof useBillingContext>
	data: BillingContext
	intent: BillingQuoteRequest['intent']
	locked: boolean
	onSubmit: (
		build: (commandId: string) => BillingMutation
	) => Promise<void>
}) => {
	const { actor } = context
	const period = data.billing.period
	const [cycle, setCycle] = useState<BillingCycle>(
		intent === 'CHECKOUT' ? 'MONTHLY' : (period?.cycle ?? 'MONTHLY')
	)
	const [seats, setSeats] = useState(
		String(
			intent === 'CHECKOUT'
				? minimumSeats(intent, data)
				: (period?.totalSeats ?? data.billing.policy.includedSeats)
		)
	)
	const [quote, setQuote] = useState<BillingQuote | null>(null)
	const [quoteReceivedAt, setQuoteReceivedAt] = useState(0)
	const [autoRenew, setAutoRenew] = useState(false)
	const [loading, setLoading] = useState(false)
	const [failure, setFailure] = useState<string | null>(null)
	const [now, setNow] = useState(0)
	const mounted = useRef(true)
	const requestSequence = useRef(0)
	const loadingToastId = useRef<string | null>(null)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			requestSequence.current += 1
			if (loadingToastId.current) toast.dismiss(loadingToastId.current)
		}
	}, [])
	useEffect(() => {
		if (!quote) return
		const tick = () => setNow(performance.now())
		tick()
		const timer = window.setInterval(tick, 1000)
		return () => window.clearInterval(timer)
	}, [quote])
	const permitted =
		intent === 'CHECKOUT'
			? data.capabilities.checkout
			: intent === 'SEAT_CHANGE'
				? data.capabilities.changeSeats
				: data.capabilities.confirmRenewalPrice
	const enabled =
		context.ready &&
		data.capabilities.quote &&
		permitted &&
		!locked &&
		!loading
	const minSeats = minimumSeats(intent, data)
	const validSeats =
		/^[1-9][0-9]{0,4}$/.test(seats) &&
		Number(seats) >= minSeats &&
		Number(seats) <= 10000
	const seatsError = validSeats
		? undefined
		: Number(seats) < minSeats && /^[1-9][0-9]{0,4}$/.test(seats)
			? intent === 'RENEWAL'
				? `В текущем тарифе минимум мест, включая владельца: ${minSeats}. Для изменения числа мест оформите новую оплату по этому тарифу.`
				: `Количество мест вместе с владельцем должно быть не меньше ${minSeats}.`
			: `Укажите целое количество мест от ${minSeats} до 10 000.`
	const current = (sequence: number) =>
		mounted.current &&
		sequence === requestSequence.current &&
		actor.current()
	const quoteFresh =
		!!quote &&
		validSeats &&
		quote.billingVersion === data.billing.billingVersion &&
		quote.priceSnapshot.policyVersion ===
			(intent === 'SEAT_CHANGE' && period
				? period.priceSnapshot.policyVersion
				: data.billing.policy.policyVersion) &&
		quote.priceSnapshot.includedSeats ===
			(intent === 'SEAT_CHANGE' && period
				? period.priceSnapshot.includedSeats
				: data.billing.policy.includedSeats) &&
		quote.cycle === cycle &&
		quote.totalSeats === Number(seats) &&
		Math.max(0, now - quoteReceivedAt) <
			Date.parse(quote.validUntil) - Date.parse(quote.serverTime)
	const clearQuote = () => {
		requestSequence.current += 1
		if (loadingToastId.current) {
			toast.dismiss(loadingToastId.current)
			loadingToastId.current = null
		}
		setQuote(null)
		setAutoRenew(false)
		setFailure(null)
	}
	const calculate = async () => {
		if (!enabled || !validSeats || !actor.session || !navigator.onLine)
			return
		const sequence = ++requestSequence.current
		setLoading(true)
		setFailure(null)
		setQuote(null)
		setAutoRenew(false)
		const toastId = toast.loading('Пожалуйста, подождите')
		loadingToastId.current = toastId
		try {
			const token = await context.authorize()
			if (!current(sequence)) return
			const fresh = context.latestData()
			const freshPermitted =
				fresh &&
				(intent === 'CHECKOUT'
					? fresh.capabilities.checkout
					: intent === 'SEAT_CHANGE'
						? fresh.capabilities.changeSeats
						: fresh.capabilities.confirmRenewalPrice)
			if (!fresh || !fresh.capabilities.quote || !freshPermitted) {
				const message =
					'Актуальный доступ к расчёту не подтверждён. Обновите подписку.'
				setFailure(message)
				toast.error(message, { id: toastId })
				return
			}
			const freshMinimum = minimumSeats(intent, fresh)
			if (Number(seats) < freshMinimum) {
				const message = `Тариф обновился: минимум мест, включая владельца — ${freshMinimum}.`
				setFailure(message)
				toast.error(message, { id: toastId })
				return
			}
			const result = await getBillingQuote(token, {
				schemaVersion: 1,
				workspaceId: actor.workspaceId,
				intent,
				cycle,
				totalSeats: Number(seats)
			})
			if (!current(sequence)) return
			setQuote(result)
			setQuoteReceivedAt(performance.now())
			setNow(performance.now())
			toast.success('Расчёт получен. Проверьте сумму, места и даты.', {
				id: toastId
			})
		} catch (error) {
			if (!current(sequence)) return
			const message =
				error instanceof AuthenticatedApiError &&
				error.kind === 'validation'
					? 'Проверьте число мест и актуальные условия тарифа перед новым расчётом.'
					: error instanceof AuthenticatedApiError
						? error.message
						: 'Расчёт сейчас недоступен. Оплата не создавалась.'
			setFailure(message)
			toast.error(message, { id: toastId })
		} finally {
			if (loadingToastId.current === toastId) {
				if (!current(sequence)) toast.dismiss(toastId)
				loadingToastId.current = null
			}
			if (current(sequence)) setLoading(false)
		}
	}
	const submit = async () => {
		if (
			!enabled ||
			!quote ||
			!quoteFresh ||
			!validSeats ||
			(intent === 'RENEWAL' && !autoRenew)
		)
			return
		await onSubmit(commandId => {
			const base = {
				schemaVersion: 1 as const,
				workspaceId: actor.workspaceId,
				commandId,
				expectedBillingVersion: quote.billingVersion
			}
			if (intent === 'SEAT_CHANGE' && quote.period)
				return {
					action: 'seats',
					body: {
						...base,
						expectedPeriodId: quote.period.id,
						expectedPeriodVersion: quote.period.version,
						newTotalSeats: quote.totalSeats
					}
				}
			if (intent === 'RENEWAL')
				return {
					action: 'renewal/confirm-price',
					body: {
						...base,
						expectedRenewalVersion: data.billing.renewal.version,
						expectedPolicyVersion: quote.priceSnapshot.policyVersion,
						consentVersion: quote.consent.version
					}
				}
			return {
				action: 'checkout',
				body: {
					...base,
					expectedPolicyVersion: quote.priceSnapshot.policyVersion,
					cycle: quote.cycle,
					totalSeats: quote.totalSeats,
					autoRenew,
					consentVersion: autoRenew ? quote.consent.version : null
				}
			}
		})
	}
	return (
		<div className={styles.form}>
			<div className={styles.fields}>
				<SelectField
					label="Период"
					value={cycle}
					disabled={!enabled || intent !== 'CHECKOUT'}
					onChange={event => {
						setCycle(event.target.value as BillingCycle)
						clearQuote()
					}}
				>
					<option value="MONTHLY">Ежемесячно</option>
					<option value="YEARLY">Ежегодно</option>
				</SelectField>
				<TextField
					label="Всего мест"
					type="number"
					inputMode="numeric"
					min={minSeats}
					max={10000}
					step={1}
					value={seats}
					disabled={!enabled || intent === 'RENEWAL'}
					onChange={event => {
						setSeats(event.target.value)
						clearQuote()
					}}
					hint={`Сейчас занято: ${data.capacity.usedSeats}. Минимум мест, включая владельца: ${minSeats}.`}
					error={seatsError}
				/>
			</div>
			<Button
				variant="secondary"
				tooltip="Получить актуальную стоимость и условия с сервера. Заказ пока не создаётся"
				onClick={() => void calculate()}
				disabled={!enabled || !validSeats}
				isLoading={loading}
			>
				{quote ? 'Обновить расчёт' : 'Рассчитать на сервере'}
			</Button>
			{failure ? (
				<p className={styles.error} role="alert">
					{failure}
				</p>
			) : null}
			{quote && context.ready ? (
				<>
					<BillingQuotePreview quote={quote} />
					{intent !== 'SEAT_CHANGE' ? (
						<>
							<label className={styles.consent}>
								<input
									type="checkbox"
									checked={autoRenew}
									disabled={!enabled || !quoteFresh}
									onChange={event => {
										setAutoRenew(event.target.checked)
										toast(
											event.target.checked
												? 'Согласие выбрано. Оно будет сохранено только после подтверждения команды.'
												: 'Согласие не выбрано.'
										)
									}}
								/>
								<span>
									{intent === 'RENEWAL'
										? 'Подтверждаю новую стоимость следующих автосписаний и принимаю условия ниже.'
										: 'Согласен на сохранение способа оплаты и автоматическое продление aeroCRM по условиям ниже.'}
								</span>
							</label>
							<details>
								<summary>
									Условия согласия · {quote.consent.version}
								</summary>
								<p className={styles.terms}>{quote.consent.text}</p>
							</details>
						</>
					) : null}
					{!quoteFresh ? (
						<p className={styles.notice}>
							Расчёт устарел. Обновите его перед подтверждением; сумма не
							подставляется автоматически.
						</p>
					) : null}
					{intent === 'RENEWAL' ? (
						<p className={styles.notice}>
							Меняется только цена следующего периода. Если дата
							автосписания уже наступила, платёж может быть отправлен после
							подтверждения.
						</p>
					) : null}
					<Button
						tooltip={
							intent === 'SEAT_CHANGE'
								? 'Применить рассчитанное количество мест и новый срок без дополнительного списания'
								: intent === 'RENEWAL'
									? 'Согласиться с новой ценой автосписаний. Наступившее списание может начаться после подтверждения'
									: 'Создать заказ по показанному расчёту. Переход к оплате будет отдельным действием'
						}
						disabled={
							!enabled ||
							!quoteFresh ||
							(intent === 'RENEWAL' && !autoRenew)
						}
						onClick={() => void submit()}
					>
						{intent === 'SEAT_CHANGE'
							? 'Изменить места и срок без списания'
							: intent === 'RENEWAL'
								? 'Подтвердить новую цену автопродления'
								: 'Создать заказ на оплату'}
					</Button>
				</>
			) : null}
		</div>
	)
}
