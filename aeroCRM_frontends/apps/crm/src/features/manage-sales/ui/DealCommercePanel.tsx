'use client'

import {
	getDealCommerce,
	replaceDealLines,
	saveDealLineToCatalog,
	getDealPayments,
	createDealPayment,
	correctDealPayment,
	listDealQuotes,
	createDealQuote,
	downloadDealQuote,
	listCommerceHistory
} from '@/entities/sales/api/commerce.api'
import {
	Button,
	HelpHint,
	ScreenState,
	TextField,
	TextareaField
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
	useCommerceCommand,
	type CommerceContext
} from '../model/use-commerce-command'
import { useSalesAssignees } from '../model/use-sales-assignees'
import { commerceFormError } from '../model/commerce-form'
import { CommerceCommandState } from './CommerceCommandState'
import {
	DealLinesEditor,
	type DealLineInput,
	type DealLinesRecord
} from './DealLinesEditor'
import {
	DealPaymentsEditor,
	type DealPaymentInput
} from './DealPaymentsEditor'
import { salesDate, salesMoney } from './DealDetailsDrawer'
import styles from './Commerce.module.scss'

type DealMutation =
	| {
			action: 'lines'
			expectedVersion: number
			lines: DealLineInput[]
			manualAmountMinor?: number
	  }
	| {
			action: 'saveCatalog'
			lineId: string
			expectedVersion: number
			code?: string
	  }
	| { action: 'payment'; payment: DealPaymentInput }
	| {
			action: 'correctPayment'
			paymentId: string
			payment: DealPaymentInput
	  }
	| {
			action: 'quote'
			sellerName: string
			sellerDetails?: string
			customerDetails?: string
	  }
const historyLabels: Record<string, string> = {
	LINES_REPLACED: 'Состав и сумма сделки изменены',
	LINE_SAVED_CATALOG: 'Разовая строка сохранена в каталог',
	PAYMENT_ADDED: 'Добавлена запись об оплате или возврате',
	PAYMENT_CORRECTED: 'Исправлена денежная операция',
	QUOTE_CREATED: 'Сформировано коммерческое предложение'
}
const historyDetails = (value: unknown): string | null => {
	if (!value || typeof value !== 'object') return null
	const details = value as Record<string, unknown>
	const before = details.before as Record<string, unknown> | undefined
	const after = details.after as Record<string, unknown> | undefined
	if (
		before &&
		after &&
		typeof before.amountMinor === 'number' &&
		typeof after.amountMinor === 'number'
	)
		return `${salesMoney(before.amountMinor)} → ${salesMoney(after.amountMinor)}`
	if (typeof details.version === 'number')
		return `Версия ${details.version}`
	return null
}

export const DealCommercePanel = ({
	context,
	dealId,
	onSaved,
	onBusyChange
}: {
	context: CommerceContext
	dealId: string
	onSaved: () => void
	onBusyChange: (busy: boolean) => void
}) => {
	const client = useQueryClient()
	const [revision, setRevision] = useState(0)
	const [confirmedLineVersion, setConfirmedLineVersion] = useState<
		number | null
	>(null)
	const [sellerName, setSellerName] = useState('')
	const [sellerDetails, setSellerDetails] = useState('')
	const [customerDetails, setCustomerDetails] = useState('')
	const [download, setDownload] = useState<string | null>(null)
	const [downloadError, setDownloadError] = useState<string | null>(null)
	const [linesDirty, setLinesDirty] = useState(false)
	const token = context.session?.accessToken || ''
	const workspaceId = context.workspace.workspaceId
	const lines = useQuery({
		queryKey: ['sales', 'commerce-lines', ...context.key, dealId],
		enabled: context.canRead,
		queryFn: () => getDealCommerce(token, workspaceId, dealId),
		retry: false,
		gcTime: 0
	})
	const payments = useQuery({
		queryKey: ['sales', 'commerce-payments', ...context.key, dealId],
		enabled: context.canRead,
		queryFn: () => getDealPayments(token, workspaceId, dealId),
		retry: false,
		gcTime: 0
	})
	const quotes = useQuery({
		queryKey: ['sales', 'commerce-quotes', ...context.key, dealId],
		enabled: context.canRead,
		queryFn: () => listDealQuotes(token, workspaceId, dealId),
		retry: false,
		gcTime: 0
	})
	const history = useQuery({
		queryKey: ['sales', 'commerce-history', ...context.key, dealId],
		enabled: context.canRead,
		queryFn: () => listCommerceHistory(token, workspaceId, dealId),
		retry: false,
		gcTime: 0
	})
	const reload = async () => {
		const result = await Promise.all([
			context.permissions.refetch(),
			lines.refetch(),
			payments.refetch(),
			quotes.refetch(),
			history.refetch()
		])
		if (result.some(value => value.isError))
			throw new Error('Не удалось обновить данные')
		setRevision(value => value + 1)
	}
	const command = useCommerceCommand<DealMutation, unknown>(
		context,
		`deal:${dealId}`,
		(accessToken, input) => {
			const base = { commandId: input.commandId }
			switch (input.action) {
				case 'lines':
					return replaceDealLines(accessToken, workspaceId, dealId, {
						...base,
						expectedVersion: input.expectedVersion,
						lines: input.lines,
						...(input.manualAmountMinor === undefined
							? {}
							: { manualAmountMinor: input.manualAmountMinor })
					})
				case 'saveCatalog':
					return saveDealLineToCatalog(
						accessToken,
						workspaceId,
						dealId,
						input.lineId,
						{
							...base,
							expectedVersion: input.expectedVersion,
							...(input.code ? { code: input.code } : {})
						}
					)
				case 'payment':
					return createDealPayment(accessToken, workspaceId, dealId, {
						...base,
						...input.payment
					})
				case 'correctPayment':
					return correctDealPayment(
						accessToken,
						workspaceId,
						dealId,
						input.paymentId,
						{ ...base, replacement: input.payment }
					)
				case 'quote':
					return createDealQuote(accessToken, workspaceId, dealId, {
						...base,
						sellerName: input.sellerName,
						...(input.sellerDetails
							? { sellerDetails: input.sellerDetails }
							: {}),
						...(input.customerDetails
							? { customerDetails: input.customerDetails }
							: {})
					})
			}
		},
		result => {
			if (
				result &&
				typeof result === 'object' &&
				'mode' in result &&
				'dealVersion' in result
			) {
				const saved = result as DealLinesRecord
				client.setQueryData(
					['sales', 'commerce-lines', ...context.key, dealId],
					saved
				)
				setConfirmedLineVersion(saved.dealVersion)
			}
			setRevision(value => value + 1)
			setLinesDirty(false)
			onSaved()
			void client.invalidateQueries({ queryKey: ['sales'] })
		}
	)
	const busy =
		command.running || command.uncertain || !!download || linesDirty
	useEffect(() => {
		onBusyChange(busy)
		return () => onBusyChange(false)
	}, [busy, onBusyChange])
	const authorName = useSalesAssignees(context, [
		...(payments.data?.items.map(item => item.createdBySubject) || []),
		...(history.data?.map(item => item.actorSubject) || [])
	])
	const downloadQuote = async (id: string) => {
		if (download || !context.canRead) return
		setDownload(id)
		setDownloadError(null)
		try {
			await downloadDealQuote(token, workspaceId, dealId, id)
			toast.success('КП подготовлено для скачивания')
		} catch (cause) {
			setDownloadError(commerceFormError(cause))
		} finally {
			setDownload(null)
		}
	}
	if (!context.canRead) return null
	return (
		<div className={styles.stack}>
			<CommerceCommandState command={command} onReview={reload} />
			{lines.isError ? (
				<ScreenState
					variant="error"
					compact
					title="Состав сделки недоступен"
					action={
						<Button
							variant="secondary"
							onClick={() => void lines.refetch()}
						>
							Повторить
						</Button>
					}
				/>
			) : lines.isPending ? (
				<ScreenState
					variant="loading"
					compact
					title="Загружаем состав сделки"
				/>
			) : (
				<DealLinesEditor
					context={context}
					data={lines.data}
					confirmedLineVersion={confirmedLineVersion}
					locked={command.locked || lines.isFetching}
					onDirtyChange={setLinesDirty}
					onReplace={input =>
						void command.execute({ action: 'lines', ...input })
					}
					onSaveCatalog={(lineId, expectedVersion, code) =>
						void command.execute({
							action: 'saveCatalog',
							lineId,
							expectedVersion,
							code
						})
					}
				/>
			)}
			<section
				className={styles.section}
				aria-labelledby="deal-quotes-title"
			>
				<h3 id="deal-quotes-title">Коммерческие предложения</h3>
				<HelpHint
					label="Версии КП"
					description="КП фиксирует состав и цены сделки на момент создания. Чтобы получить КП с новыми позициями, сохраните состав и сформируйте новую версию."
				/>
				<p className={styles.muted}>
					КП создаётся из сохранённого состава сделки. Каждая версия
					сохраняет свои данные: последующие изменения сделки и каталога на
					неё не влияют.
				</p>
				{context.canWrite && (
					<form
						className={styles.stack}
						onSubmit={event => {
							event.preventDefault()
							if (
								!command.locked &&
								!linesDirty &&
								lines.data?.items.length
							)
								void command.execute({
									action: 'quote',
									sellerName: sellerName.trim(),
									sellerDetails: sellerDetails.trim() || undefined,
									customerDetails: customerDetails.trim() || undefined
								})
						}}
					>
						<fieldset
							className={styles.fields}
							disabled={
								command.locked ||
								linesDirty ||
								lines.isFetching ||
								!lines.data?.items.length
							}
						>
							<TextField
								label="Продавец / исполнитель"
								value={sellerName}
								required
								maxLength={200}
								placeholder="Название компании или имя предпринимателя"
								onChange={event => setSellerName(event.target.value)}
							/>
							<TextareaField
								label="Реквизиты и контакты продавца"
								value={sellerDetails}
								maxLength={1000}
								rows={3}
								placeholder="ИНН, адрес, телефон, email — при необходимости"
								onChange={event => setSellerDetails(event.target.value)}
							/>
							<TextareaField
								label="Реквизиты и контакты клиента"
								value={customerDetails}
								maxLength={1000}
								rows={3}
								hint="Имя клиента будет взято из сделки."
								onChange={event => setCustomerDetails(event.target.value)}
							/>
							<Button
								type="submit"
								isLoading={command.running}
								tooltip="Сохранить отдельную версию КП из уже сохранённого состава сделки"
							>
								Сформировать КП
							</Button>
						</fieldset>
						{!lines.data?.items.length && (
							<p className={styles.muted}>
								Для формирования КП сначала добавьте и сохраните позиции
								сделки.
							</p>
						)}
						{linesDirty && (
							<p className={styles.muted}>
								Сначала сохраните или отмените изменения состава.
							</p>
						)}
					</form>
				)}
				{downloadError && (
					<p className={styles.error} role="alert">
						{downloadError}
					</p>
				)}
				{quotes.isError ? (
					<ScreenState
						variant="error"
						compact
						description="Не удалось загрузить сформированные КП."
						action={
							<Button
								variant="secondary"
								onClick={() => void quotes.refetch()}
							>
								Повторить
							</Button>
						}
					/>
				) : quotes.isPending ? (
					<ScreenState variant="loading" compact />
				) : quotes.data.length ? (
					<ol
						className={styles.stack}
						aria-label="Версии коммерческого предложения"
					>
						{quotes.data.map(quote => (
							<li key={quote.id} className={styles.item}>
								<div className={styles.heading}>
									<strong>КП · версия {quote.version}</strong>
									<strong>{salesMoney(quote.snapshot.amountMinor)}</strong>
								</div>
								<p className={styles.muted}>
									{salesDate(quote.createdAt)} ·{' '}
									{quote.snapshot.sellerName}
								</p>
								<Button
									variant="secondary"
									disabled={!!download}
									isLoading={download === quote.id}
									onClick={() => void downloadQuote(quote.id)}
								>
									Скачать КП
								</Button>
							</li>
						))}
					</ol>
				) : (
					<p className={styles.muted}>
						Коммерческие предложения пока не сформированы.
					</p>
				)}
				<p className={styles.muted}>
					Документ скачивается в HTML. Откройте его в браузере, чтобы
					распечатать или сохранить в PDF. Автоматическая отправка клиенту
					не выполняется.
				</p>
			</section>
			{payments.isError ? (
				<ScreenState
					variant="error"
					compact
					title="Журнал оплат недоступен"
					description="Суммы не подменяются нулями."
					action={
						<Button
							variant="secondary"
							onClick={() => void payments.refetch()}
						>
							Повторить
						</Button>
					}
				/>
			) : payments.isPending ? (
				<ScreenState variant="loading" compact title="Загружаем оплаты" />
			) : (
				<DealPaymentsEditor
					key={`${payments.data.dealVersion}:${revision}`}
					data={payments.data}
					canWrite={context.canWrite}
					locked={command.locked || payments.isFetching || linesDirty}
					authorName={authorName}
					onAdd={payment =>
						void command.execute({ action: 'payment', payment })
					}
					onCorrect={(paymentId, payment) =>
						void command.execute({
							action: 'correctPayment',
							paymentId,
							payment
						})
					}
				/>
			)}
			<section className={styles.section}>
				<h3>История состава, КП и оплат</h3>
				{history.isError ? (
					<ScreenState
						variant="error"
						compact
						action={
							<Button
								variant="secondary"
								onClick={() => void history.refetch()}
							>
								Повторить
							</Button>
						}
					/>
				) : history.isPending ? (
					<ScreenState variant="loading" compact />
				) : history.data.length ? (
					<ol className={styles.history}>
						{history.data.map(item => (
							<li key={item.id}>
								<strong>
									{historyLabels[item.kind] || 'Изменение по сделке'}
								</strong>
								{historyDetails(item.details) && (
									<p>{historyDetails(item.details)}</p>
								)}
								<p>
									<time dateTime={item.createdAt}>
										{salesDate(item.createdAt)}
									</time>{' '}
									· {authorName(item.actorSubject)}
								</p>
							</li>
						))}
					</ol>
				) : (
					<p className={styles.muted}>Изменений пока нет.</p>
				)}
			</section>
		</div>
	)
}
