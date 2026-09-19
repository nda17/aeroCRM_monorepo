import type { BillingQuote } from '@/entities/crm-billing'
import {
	billingCycleLabel,
	billingDate,
	billingMoney
} from '../model/billing-display'
import styles from './BillingFlow.module.scss'

export const BillingQuotePreview = ({
	quote
}: {
	quote: BillingQuote
}) => (
	<section className={styles.quote} aria-label="Расчёт сервера">
		<div className={styles.sectionHeading}>
			<h3>
				{quote.intent === 'SEAT_CHANGE'
					? 'Как изменится срок доступа'
					: quote.intent === 'RENEWAL'
						? 'Следующее автопродление'
						: 'Ваш оплаченный период'}
			</h3>
			<span className={styles.tag}>Расчёт сервера</span>
		</div>
		<dl className={styles.facts}>
			<div>
				<dt>Период расчёта</dt>
				<dd>{billingCycleLabel(quote.cycle)}</dd>
			</div>
			<div>
				<dt>Всего мест, включая владельца</dt>
				<dd>{quote.totalSeats}</dd>
			</div>
			<div>
				<dt>
					{quote.intent === 'SEAT_CHANGE'
						? 'Полная стоимость периода с новым количеством мест'
						: quote.intent === 'RENEWAL'
							? 'Стоимость следующего автопродления'
							: 'К оплате'}
				</dt>
				<dd className={styles.amount}>
					{billingMoney(quote.amountMinor)}
				</dd>
			</div>
			{quote.period ? (
				<>
					<div>
						<dt>Прежнее количество мест</dt>
						<dd>{quote.period.oldTotalSeats}</dd>
					</div>
					<div>
						<dt>Срок до изменения</dt>
						<dd>{billingDate(quote.period.oldExpiresAt)}</dd>
					</div>
				</>
			) : (
				<div>
					<dt>Начало оплаченного периода</dt>
					<dd>{billingDate(quote.startsAt)}</dd>
				</div>
			)}
			<div>
				<dt>
					{quote.period
						? 'Срок после изменения'
						: 'Окончание оплаченного периода'}
				</dt>
				<dd>{billingDate(quote.expiresAt)}</dd>
			</div>
		</dl>
		<p className={styles.note}>
			{quote.intent === 'SEAT_CHANGE'
				? 'Дополнительного списания или возврата нет: меняется оставшееся оплаченное время. Используются цены сохранённого периода, а не текущие опубликованные условия.'
				: quote.intent === 'RENEWAL'
					? 'Новые условия относятся только к следующему периоду. Уже оплаченный период и его сохранённые цены не изменяются.'
					: 'Если бесплатный период ещё действует, оплаченный период начнётся после него. Оплата не сокращает ваши пять дней Trial.'}
		</p>
		<p className={styles.meta}>
			Расчёт действителен до {billingDate(quote.validUntil)}. Итог
			подтверждается сервером при выполнении команды.
		</p>
	</section>
)
