'use client'

import {
	Button,
	HelpHint,
	SelectField,
	StatusBadge,
	TextareaField,
	TextField
} from '@/shared/ui'
import { useState } from 'react'
import {
	commerceFormError,
	moneyInput,
	parseMoneyInput
} from '../model/commerce-form'
import { salesDate, salesMoney } from './DealDetailsDrawer'
import styles from './Commerce.module.scss'

export type DealPaymentRecord = {
	id: string
	kind: 'RECEIPT' | 'REFUND' | 'VOID_RECEIPT' | 'VOID_REFUND'
	amountMinor: number
	occurredAt: string
	comment: string
	correctsPaymentId: string | null
	createdBySubject: string
	createdAt: string
}
export type DealPaymentsRecord = {
	dealId: string
	dealVersion: number
	amountMinor: number
	netPaidMinor: number
	balanceMinor: number
	overpaidMinor: number
	items: DealPaymentRecord[]
}
export type DealPaymentInput = {
	kind: 'RECEIPT' | 'REFUND'
	amountMinor: number
	occurredAt: string
	comment: string
}
const localInput = (instant: string) => {
	const date = new Date(instant)
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
		.toISOString()
		.slice(0, 16)
}

const PaymentForm = ({
	payment,
	locked,
	onSave,
	onCancel
}: {
	payment: DealPaymentRecord | null
	locked: boolean
	onSave: (value: DealPaymentInput) => void
	onCancel: () => void
}) => {
	const [kind, setKind] = useState<'RECEIPT' | 'REFUND'>(
		payment?.kind === 'REFUND' ? 'REFUND' : 'RECEIPT'
	)
	const [amount, setAmount] = useState(
		payment ? moneyInput(payment.amountMinor) : ''
	)
	const [occurredAt, setOccurredAt] = useState(() =>
		localInput(payment?.occurredAt || new Date().toISOString())
	)
	const [comment, setComment] = useState(payment?.comment || '')
	const [error, setError] = useState<string | null>(null)
	return (
		<form
			className={styles.item}
			onSubmit={event => {
				event.preventDefault()
				if (locked) return
				try {
					const amountMinor = parseMoneyInput(amount)!
					if (amountMinor <= 0)
						throw new Error('Сумма операции должна быть больше нуля.')
					const date = new Date(occurredAt)
					if (!Number.isFinite(date.getTime()))
						throw new Error('Укажите дату и время операции.')
					setError(null)
					onSave({
						kind,
						amountMinor,
						occurredAt: date.toISOString(),
						comment: comment.trim()
					})
				} catch (cause) {
					setError(commerceFormError(cause))
				}
			}}
		>
			<h3>{payment ? 'Исправить операцию' : 'Новая операция'}</h3>
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			<fieldset className={styles.fields} disabled={locked}>
				<SelectField
					label="Вид операции"
					value={kind}
					onChange={event =>
						setKind(event.target.value as 'RECEIPT' | 'REFUND')
					}
				>
					<option value="RECEIPT">Поступление</option>
					<option value="REFUND">Возврат</option>
				</SelectField>
				<div className={styles.grid}>
					<TextField
						label="Сумма операции, ₽"
						value={amount}
						required
						inputMode="decimal"
						onChange={event => setAmount(event.target.value)}
					/>
					<TextField
						label="Дата и время операции"
						type="datetime-local"
						value={occurredAt}
						required
						onChange={event => setOccurredAt(event.target.value)}
					/>
				</div>
				<TextareaField
					label={
						payment ? 'Комментарий и причина исправления' : 'Комментарий'
					}
					value={comment}
					maxLength={1000}
					rows={3}
					onChange={event => setComment(event.target.value)}
					required={!!payment}
				/>
				<p className={styles.muted}>
					{payment
						? 'Исходная операция и запись об исправлении сохранятся в журнале.'
						: 'Это ручная запись фактически полученных или возвращённых денег. Банковский платёж не создаётся.'}
				</p>
				{kind === 'REFUND' && (
					<p className={styles.muted}>
						Возврат не может превышать ранее полученную сумму с учётом
						других возвратов. Дата возврата не должна предшествовать
						достаточной оплате.
					</p>
				)}
				<div className={styles.actions}>
					<Button type="submit">
						{payment ? 'Сохранить исправление' : 'Записать операцию'}
					</Button>
					<Button variant="ghost" onClick={onCancel}>
						Отмена
					</Button>
				</div>
			</fieldset>
		</form>
	)
}

export const DealPaymentsEditor = ({
	data,
	canWrite,
	locked,
	authorName,
	onAdd,
	onCorrect
}: {
	data: DealPaymentsRecord
	canWrite: boolean
	locked: boolean
	authorName: (subject: string) => string
	onAdd: (value: DealPaymentInput) => void
	onCorrect: (id: string, value: DealPaymentInput) => void
}) => {
	const [editing, setEditing] = useState<DealPaymentRecord | 'new' | null>(
		null
	)
	const corrected = new Set(
		data.items
			.filter(item => item.kind.startsWith('VOID_'))
			.map(item => item.correctsPaymentId)
	)
	const status =
		data.overpaidMinor > 0
			? 'Переплата'
			: data.netPaidMinor === 0
				? 'Не оплачено'
				: data.balanceMinor > 0
					? 'Частичная оплата'
					: 'Оплачено'
	return (
		<section
			className={styles.section}
			aria-labelledby="deal-payments-title"
		>
			<div className={styles.heading}>
				<h3 id="deal-payments-title">Оплаты клиента</h3>
				<HelpHint
					label="Учёт оплат клиента"
					description="Записи об оплатах и возвратах по сделке вводятся вручную. Это учёт фактов, а не приём денег через CRM; исправление оставляет прежнюю запись в истории."
				/>
				<StatusBadge tone={data.balanceMinor > 0 ? 'info' : 'success'}>
					{status}
				</StatusBadge>
			</div>
			<p className={styles.muted}>
				Ручной учёт поступлений и возвратов по сделке. Оплата не меняет
				этап, закрытие сделки не создаёт оплату. Подписка на aeroCRM
				оплачивается отдельно.
			</p>
			<dl className={styles.metrics}>
				<div>
					<dt>Стоимость сделки</dt>
					<dd>{salesMoney(data.amountMinor)}</dd>
				</div>
				<div>
					<dt>Чистая оплаченная сумма</dt>
					<dd>{salesMoney(data.netPaidMinor)}</dd>
				</div>
				<div>
					<dt>Остаток к оплате</dt>
					<dd>{salesMoney(data.balanceMinor)}</dd>
				</div>
				<div>
					<dt>Переплата</dt>
					<dd>{salesMoney(data.overpaidMinor)}</dd>
				</div>
			</dl>
			{canWrite && !editing && (
				<Button
					variant="secondary"
					tooltip="Вручную записать поступление или возврат клиента по этой сделке; деньги через CRM не списываются"
					disabled={locked}
					onClick={() => setEditing('new')}
				>
					Добавить оплату или возврат
				</Button>
			)}
			{editing && (
				<PaymentForm
					key={editing === 'new' ? 'new' : editing.id}
					payment={editing === 'new' ? null : editing}
					locked={locked}
					onCancel={() => setEditing(null)}
					onSave={value =>
						editing === 'new' ? onAdd(value) : onCorrect(editing.id, value)
					}
				/>
			)}
			{data.items.length ? (
				<ol
					className={styles.history}
					aria-label="Журнал оплат и исправлений"
				>
					{[...data.items].reverse().map(item => {
						const voided = item.kind.startsWith('VOID_')
						return (
							<li key={item.id}>
								<div className={styles.heading}>
									<strong>
										{voided
											? 'Отмена прежней записи при исправлении'
											: item.kind === 'RECEIPT'
												? 'Поступление'
												: 'Возврат'}{' '}
										· {salesMoney(item.amountMinor)}
									</strong>
									{corrected.has(item.id) && (
										<StatusBadge tone="neutral">Исправлена</StatusBadge>
									)}
								</div>
								<p>
									<time dateTime={item.occurredAt}>
										{salesDate(item.occurredAt)}
									</time>{' '}
									· {authorName(item.createdBySubject)}
								</p>
								{!voided && item.comment && <p>{item.comment}</p>}
								{canWrite && !voided && !corrected.has(item.id) && (
									<Button
										size="sm"
										variant="ghost"
										tooltip="Добавить исправление с сохранением прежней записи в истории"
										disabled={locked}
										onClick={() => setEditing(item)}
									>
										Исправить операцию
									</Button>
								)}
							</li>
						)
					})}
				</ol>
			) : (
				<p className={styles.muted}>Оплаты и возвраты пока не записаны.</p>
			)}
		</section>
	)
}
