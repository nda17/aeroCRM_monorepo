'use client'

import { UserRole, useAuthStore, useUser } from '@/entities/user'
import { crmRefundsService } from '@/features/admin-crm/api/crm-refunds.api'
import type {
	CrmRefundCommand,
	CrmRefundReviewStatus,
	CrmRefundVerificationStatus,
	CrmRefundView
} from '@/features/admin-crm/model/crm-refunds.contract'
import {
	ActorMutationNotSentError,
	isMutationActorCurrent,
	readMutationActor,
	type MutationActor
} from '@/shared/api/actor-bound-mutation'
import { useAdminDirtyGuard } from '@/screens/admin/model/navigation/AdminNavigationGuard'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import styles from './AdminCrm.module.scss'

const verificationLabels: Record<CrmRefundVerificationStatus, string> = {
	PENDING: 'Ожидает подтверждения',
	VERIFIED: 'Подтверждён ЮKassa',
	REJECTED: 'Не подтверждён',
	FAILED: 'Ошибка проверки'
}
const reviewLabels: Record<CrmRefundReviewStatus, string> = {
	PENDING: 'Нужно учесть вручную',
	REVIEWED: 'Учтён вручную'
}
const date = (value: string | null) =>
	value ? new Date(value).toLocaleString('ru-RU') : '—'
const money = (row: CrmRefundView) => {
	if (
		row.verificationStatus !== 'VERIFIED' ||
		row.amountMinor === null ||
		row.currency === null
	)
		return 'Сумма не подтверждена'
	const minor = BigInt(row.amountMinor)
	return `${(minor / BigInt(100)).toLocaleString('ru-RU')},${(minor % BigInt(100)).toString().padStart(2, '0')} ${row.currency}`
}

type PendingRefund = {
	actor: MutationActor
	id: string
	kind: 'review' | 'retry'
	command: CrmRefundCommand
}

export default function CrmRefundInbox() {
	const auth = useAuthStore(state => state.auth)
	const resolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading } = useUser()
	const canView =
		resolved &&
		auth &&
		!isLoading &&
		!!user.id &&
		user.rights?.some(
			role => role === UserRole.ADMIN || role === UserRole.DEV
		)
	return (
		<section
			className={styles.section}
			aria-labelledby="crm-refunds-title"
		>
			<div className={styles.sectionHeader}>
				<div>
					<h3 className={styles.sectionTitle} id="crm-refunds-title">
						Возвраты ЮKassa
					</h3>
					<p className={styles.sectionHint}>
						Проверенные возвраты и очередь ручного учёта. Каждый частичный
						или повторный возврат показан отдельно.
					</p>
				</div>
			</div>
			{!resolved || isLoading ? (
				<p role="status">Проверяем доступ…</p>
			) : !canView ? (
				<p>Просмотр и разбор доступны ADMIN и DEV.</p>
			) : (
				<RefundManager key={user.id} actorSubject={user.id} />
			)}
		</section>
	)
}

function RefundManager({ actorSubject }: { actorSubject: string }) {
	const client = useQueryClient()
	const [page, setPage] = useState(1)
	const [reviewStatus, setReviewStatus] = useState<
		CrmRefundReviewStatus | ''
	>('PENDING')
	const [verificationStatus, setVerificationStatus] = useState<
		CrmRefundVerificationStatus | ''
	>('')
	const [selected, setSelected] = useState<string | null>(null)
	const [comment, setComment] = useState('')
	const [pending, setPending] = useState<PendingRefund | null>(null)
	const [running, setRunning] = useState(false)
	const [conflict, setConflict] = useState(false)
	const [message, setMessage] = useState('')
	const inFlight = useRef(false)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const guard = useAdminDirtyGuard({
		label: 'Ручной учёт возврата',
		dirty: !!comment,
		pending: !!pending || running
	})
	const rootKey = ['crm-refunds', actorSubject] as const
	const refunds = useQuery({
		queryKey: [...rootKey, 'list', page, reviewStatus, verificationStatus],
		queryFn: () =>
			crmRefundsService.list(
				page,
				reviewStatus || undefined,
				verificationStatus || undefined
			),
		retry: false,
		staleTime: 0
	})
	const detail = useQuery({
		queryKey: [...rootKey, 'detail', selected],
		queryFn: () => crmRefundsService.detail(selected!),
		enabled: !!selected,
		retry: false,
		staleTime: 0
	})
	const row = detail.data
	const validComment =
		comment.trim().length > 0 &&
		comment.trim().length <= 2000 &&
		!/[\x00-\x09\x0b-\x1f\x7f]/.test(comment)
	const locked = !!pending || running
	const choose = (id: string | null) =>
		guard.confirmDiscard(() => {
			setSelected(id)
			setComment('')
			setConflict(false)
			setMessage('')
		})
	const refresh = async () => {
		const result = await detail.refetch()
		void refunds.refetch()
		if (result.isError) {
			setMessage('Не удалось подтвердить актуальное состояние возврата.')
			return
		}
		if (
			pending?.kind === 'review' &&
			result.data.reviewStatus === 'REVIEWED'
		) {
			setPending(null)
			setComment('')
			setConflict(false)
			setMessage(
				'Актуальный статус: возврат уже учтён вручную. Исполнитель, время и заметка показаны ниже.'
			)
		}
	}
	const send = async (kind: 'review' | 'retry') => {
		if (
			inFlight.current ||
			(!pending &&
				(!row || detail.isError || detail.isFetching || conflict))
		)
			return
		let attempt = pending
		try {
			if (!attempt) {
				if (
					!row ||
					(kind === 'review' &&
						(row.verificationStatus !== 'VERIFIED' ||
							row.reviewStatus !== 'PENDING' ||
							!validComment)) ||
					(kind === 'retry' &&
						!['FAILED', 'REJECTED'].includes(row.verificationStatus))
				)
					return
				attempt = {
					actor: readMutationActor(actorSubject),
					id: row.id,
					kind,
					command: {
						schemaVersion: 1,
						commandId: crypto.randomUUID(),
						expectedVersion: row.version,
						...(kind === 'review' ? { comment: comment.trim() } : {})
					}
				}
			}
			inFlight.current = true
			setRunning(true)
			setPending(attempt)
			setMessage('')
			const result = await crmRefundsService.command(
				attempt.actor,
				attempt.id,
				attempt.kind,
				attempt.command
			)
			if (!mounted.current || !isMutationActorCurrent(attempt.actor))
				return
			setPending(null)
			setComment('')
			setConflict(false)
			client.setQueryData([...rootKey, 'detail', result.id], result)
			setMessage(
				attempt.kind === 'review'
					? 'Возврат отмечен как учтённый вручную. Подписка, места и доступ этой отметкой не менялись.'
					: 'Повторная проверка возврата поставлена в очередь.'
			)
			void client.invalidateQueries({ queryKey: rootKey })
		} catch (error) {
			if (!mounted.current) return
			if (isAxiosError(error) && error.response?.status === 409) {
				setPending(null)
				setConflict(true)
				setMessage(
					'Возврат изменился. Ваша заметка сохранена. Проверьте актуальные данные перед новой командой.'
				)
				void detail.refetch()
			} else if (
				isAxiosError(error) &&
				[400, 403, 404, 422].includes(error.response?.status ?? 0)
			) {
				setPending(null)
				setMessage(
					'Команда отклонена. Проверьте актуальные данные и права; заметка сохранена.'
				)
			} else if (error instanceof ActorMutationNotSentError && !pending) {
				setPending(null)
				setMessage(error.message)
			} else
				setMessage(
					'Результат команды не подтверждён. Обновите состояние или повторите ту же команду. Номер и заметка сохраняются на этом экране до подтверждения.'
				)
		} finally {
			inFlight.current = false
			if (mounted.current) setRunning(false)
		}
	}
	const submit = (event: FormEvent) => {
		event.preventDefault()
		void send('review')
	}
	return (
		<>
			<p className={styles.sectionHint}>
				Срок подписки, число мест и доступ корректируются отдельно в блоке
				«Подписки aeroCRM». Сначала выполните необходимые ручные изменения,
				затем сохраните здесь заметку об учёте. Эта форма не отправляет
				деньги и не меняет подписку.
			</p>
			<div className={styles.refundFilters}>
				<label>
					Ручной учёт
					<select
						className={styles.providerSelect}
						value={reviewStatus}
						disabled={locked}
						onChange={event => {
							setReviewStatus(event.target.value as typeof reviewStatus)
							setPage(1)
						}}
					>
						<option value="">Все</option>
						<option value="PENDING">Нужно учесть</option>
						<option value="REVIEWED">Учтены</option>
					</select>
				</label>
				<label>
					Проверка ЮKassa
					<select
						className={styles.providerSelect}
						value={verificationStatus}
						disabled={locked}
						onChange={event => {
							setVerificationStatus(
								event.target.value as typeof verificationStatus
							)
							setPage(1)
						}}
					>
						<option value="">Все</option>
						{Object.entries(verificationLabels).map(([status, label]) => (
							<option key={status} value={status}>
								{label}
							</option>
						))}
					</select>
				</label>
				<button
					className={styles.refreshButton}
					type="button"
					disabled={refunds.isFetching || running}
					onClick={() => void refunds.refetch()}
				>
					Обновить список
				</button>
			</div>
			{refunds.isPending ? (
				<p role="status">Загружаем возвраты…</p>
			) : refunds.isError ? (
				<p role="alert">Не удалось загрузить возвраты. Обновите список.</p>
			) : (
				<>
					<p className={styles.sectionHint}>
						Найдено: {refunds.data.total}
					</p>
					{refunds.data.items.map(item => (
						<article className={styles.providerOperation} key={item.id}>
							<strong>
								{verificationLabels[item.verificationStatus]} ·{' '}
								{reviewLabels[item.reviewStatus]}
							</strong>
							<span>
								{money(item)} ·{' '}
								{item.providerMode === 'LIVE'
									? 'Рабочий магазин'
									: 'Тестовый магазин'}
							</span>
							<span>Возврат: {item.providerRefundId}</span>
							<small>{date(item.createdAt)}</small>
							<button
								className={styles.refreshButton}
								type="button"
								disabled={locked}
								onClick={() => choose(item.id)}
							>
								Открыть возврат
							</button>
						</article>
					))}
					{!refunds.data.items.length ? (
						<p>Возвратов по выбранным условиям нет.</p>
					) : null}
					<div className={styles.providerPager}>
						<button
							className={styles.refreshButton}
							type="button"
							disabled={locked || page <= 1 || refunds.isFetching}
							onClick={() => setPage(value => value - 1)}
						>
							Назад
						</button>
						<span>Страница {page}</span>
						<button
							className={styles.refreshButton}
							type="button"
							disabled={
								locked ||
								page * 20 >= refunds.data.total ||
								refunds.isFetching
							}
							onClick={() => setPage(value => value + 1)}
						>
							Далее
						</button>
					</div>
				</>
			)}
			{selected ? (
				<section
					className={styles.refundDetail}
					aria-labelledby="refund-detail-title"
				>
					<div className={styles.sectionHeader}>
						<h4 className={styles.sectionTitle} id="refund-detail-title">
							Разбор возврата
						</h4>
						<button
							className={styles.refreshButton}
							type="button"
							disabled={locked}
							onClick={() => choose(null)}
						>
							Закрыть разбор
						</button>
					</div>
					{detail.isPending ? (
						<p role="status">Загружаем данные возврата…</p>
					) : null}
					{detail.isError ? (
						<p role="alert">
							Не удалось подтвердить актуальные данные возврата.
						</p>
					) : row ? (
						<>
							<strong>
								{verificationLabels[row.verificationStatus]} ·{' '}
								{reviewLabels[row.reviewStatus]}
							</strong>
							<dl className={styles.refundFacts}>
								<div>
									<dt>Сумма</dt>
									<dd>{money(row)}</dd>
								</div>
								<div>
									<dt>Магазин</dt>
									<dd>
										{row.shopId} · {row.providerMode}
									</dd>
								</div>
								<div>
									<dt>Возврат ЮKassa</dt>
									<dd>{row.providerRefundId}</dd>
								</div>
								<div>
									<dt>Платёж ЮKassa</dt>
									<dd>{row.providerPaymentId ?? 'Не подтверждён'}</dd>
								</div>
								<div>
									<dt>Заказ</dt>
									<dd>{row.orderId ?? 'Не подтверждён'}</dd>
								</div>
								<div>
									<dt>Рабочее пространство</dt>
									<dd>{row.workspaceId ?? 'Не подтверждено'}</dd>
								</div>
								<div>
									<dt>Проверено</dt>
									<dd>{date(row.verifiedAt)}</dd>
								</div>
							</dl>
							{row.lastErrorCode ? (
								<p className={styles.sectionHint}>
									Код проверки: {row.lastErrorCode}
								</p>
							) : null}
							{row.reviewStatus === 'REVIEWED' ? (
								<div>
									<p>
										Учтён вручную: {date(row.reviewedAt)} ·{' '}
										{row.reviewedBy}
									</p>
									<p className={styles.refundNote}>{row.reviewComment}</p>
								</div>
							) : (
								<form onSubmit={submit}>
									<label className={styles.refundField}>
										Что сделано вручную
										<textarea
											value={comment}
											rows={4}
											maxLength={2000}
											required
											disabled={
												locked || row.verificationStatus !== 'VERIFIED'
											}
											onChange={event => setComment(event.target.value)}
											placeholder="Какие изменения подписки, мест или доступа выполнены; либо почему изменения не потребовались"
										/>
									</label>
									<p className={styles.sectionHint}>
										{row.verificationStatus === 'VERIFIED'
											? 'Отметка сохраняет результат ручного разбора и заметку администратора.'
											: 'Ручной учёт станет доступен после подтверждения возврата у ЮKassa.'}
									</p>
									{!pending ? (
										<button
											className={styles.refreshButton}
											type="submit"
											disabled={
												running ||
												conflict ||
												detail.isFetching ||
												row.verificationStatus !== 'VERIFIED' ||
												!validComment
											}
										>
											Отметить: учтён вручную
										</button>
									) : null}
								</form>
							)}
							{!pending &&
							['FAILED', 'REJECTED'].includes(row.verificationStatus) ? (
								<button
									className={styles.refreshButton}
									type="button"
									disabled={running || conflict || detail.isFetching}
									onClick={() => void send('retry')}
								>
									Повторить проверку ЮKassa
								</button>
							) : null}
							{conflict ? (
								<button
									className={styles.refreshButton}
									type="button"
									disabled={detail.isFetching || detail.isError}
									onClick={() => {
										setConflict(false)
										setMessage(
											'Актуальные данные приняты. Проверьте заметку перед сохранением.'
										)
									}}
								>
									Использовать актуальные данные, сохранив заметку
								</button>
							) : null}
						</>
					) : null}
					{message ? <p role="status">{message}</p> : null}
					{pending ? (
						<>
							<p className={styles.sectionHint}>
								Номер команды: {pending.command.commandId}
							</p>
							<button
								className={styles.refreshButton}
								type="button"
								disabled={running}
								onClick={() => void send(pending.kind)}
							>
								Повторить ту же команду
							</button>
						</>
					) : null}
					<button
						className={styles.refreshButton}
						type="button"
						disabled={running || detail.isFetching}
						onClick={() => void refresh()}
					>
						Проверить актуальный результат
					</button>
				</section>
			) : null}
		</>
	)
}
