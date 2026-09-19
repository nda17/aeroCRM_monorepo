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
				? Math.max(
						data.billing.policy.includedSeats,
						data.capacity.usedSeats
					)
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
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			requestSequence.current += 1
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
	const validSeats =
		/^[1-9][0-9]{0,4}$/.test(seats) &&
		Number(seats) >= Math.max(2, data.capacity.usedSeats) &&
		Number(seats) <= 10000
	const current = (sequence: number) =>
		mounted.current &&
		sequence === requestSequence.current &&
		actor.current()
	const quoteFresh =
		!!quote &&
		quote.billingVersion === data.billing.billingVersion &&
		quote.cycle === cycle &&
		quote.totalSeats === Number(seats) &&
		Math.max(0, now - quoteReceivedAt) <
			Date.parse(quote.validUntil) - Date.parse(quote.serverTime)
	const clearQuote = () => {
		requestSequence.current += 1
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
		toast('Запрашиваем актуальный расчёт aeroCRM')
		try {
			const token = await context.authorize()
			if (!current(sequence)) return
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
			toast.success('Расчёт получен. Проверьте сумму, места и даты.')
		} catch (error) {
			if (!current(sequence)) return
			const message =
				error instanceof AuthenticatedApiError
					? error.message
					: 'Расчёт сейчас недоступен. Оплата не создавалась.'
			setFailure(message)
			toast.error(message)
		} finally {
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
					min={Math.max(2, data.capacity.usedSeats)}
					max={10000}
					step={1}
					value={seats}
					disabled={!enabled || intent === 'RENEWAL'}
					onChange={event => {
						setSeats(event.target.value)
						clearQuote()
					}}
					hint={`Включая владельца. Сейчас занято: ${data.capacity.usedSeats}. Минимум 2 места.`}
					error={
						validSeats
							? undefined
							: 'Укажите целое количество от числа занятых мест (не менее 2) до 10 000.'
					}
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
