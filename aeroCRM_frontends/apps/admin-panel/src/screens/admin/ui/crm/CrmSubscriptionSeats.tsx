'use client'

import {
	adminCrmSubscriptionsService,
	bindCrmAdminSeatsActor,
	clearResolvedCrmAdminSeats,
	CrmAdminGrantNotSentError,
	createCrmAdminSeatsCommand,
	readPendingCrmAdminSeats,
	retainPendingCrmAdminSeats,
	type CrmAdminSeatsCommand,
	type CrmAdminSeatsContext,
	type CrmAdminSeatsRecovery,
	type CrmAdminSeatsResult,
	type PendingCrmAdminSeats
} from '@/features/admin-crm'
import ConfirmDialog from '@/shared/ui/confirm-dialog/ConfirmDialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useEffect, useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import common from './AdminCrm.module.scss'
import styles from './CrmSubscriptionAdmin.module.scss'

const BLOCKED: Record<string, string> = {
	crm_admin_seats_renewal_active:
		'Владельцу нужно сначала отключить автопродление. После этого обновите данные.',
	crm_admin_seats_future_period:
		'Уже есть будущий оплаченный период. Изменение мест будет доступно после его начала.',
	crm_admin_subscription_operation_pending:
		'Дождитесь завершения текущей оплаты или изменения подписки.',
	crm_admin_subscription_capacity_pending:
		'Дождитесь завершения предыдущего изменения мест.',
	crm_admin_subscription_suspended:
		'Подписка приостановлена или отменена. Изменение мест недоступно.',
	crm_admin_subscription_policy_invalid:
		'Не удалось проверить условия подписки. Обновите данные.',
	crm_admin_seats_below_minimum:
		'Количество мест меньше минимума тарифа или числа занятых мест.',
	crm_admin_seats_unchanged: 'Такое количество мест уже установлено.',
	crm_admin_subscription_version_conflict:
		'Подписка изменилась. Обновите данные перед новой попыткой.'
}
const formatDate = (value: string) =>
	new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })

export default function CrmSubscriptionSeats({
	actorSubject,
	workspaceId,
	online,
	externalLocked,
	onLockedChange
}: {
	actorSubject: string
	workspaceId: string | null
	online: boolean
	externalLocked: boolean
	onLockedChange: (locked: boolean) => void
}) {
	const client = useQueryClient()
	const [recovery, setRecovery] = useState<{
		pending: PendingCrmAdminSeats | null
		storageError: boolean
	}>(() => {
		try {
			bindCrmAdminSeatsActor(actorSubject)
			return {
				pending: readPendingCrmAdminSeats(actorSubject),
				storageError: false
			}
		} catch {
			return { pending: null, storageError: true }
		}
	})
	const [busy, setBusy] = useState(false)
	const [forbidden, setForbidden] = useState(false)
	const [confirmation, setConfirmation] = useState<{
		context: CrmAdminSeatsContext
		command: CrmAdminSeatsCommand
	} | null>(null)
	const [cancelConfirmation, setCancelConfirmation] = useState(false)
	const [historyPage, setHistoryPage] = useState(1)
	const pending = recovery.pending
	const target = pending?.workspaceId ?? workspaceId
	const locked = !!pending || recovery.storageError || busy || forbidden
	const mounted = useRef(true)
	const inFlight = useRef(false)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	useEffect(() => {
		onLockedChange(locked)
	}, [locked, onLockedChange])
	useEffect(() => {
		setHistoryPage(1)
	}, [target])
	const rootKey = ['admin-crm-subscriptions', actorSubject]
	const context = useQuery({
		queryKey: [...rootKey, 'seats', target],
		queryFn: () => adminCrmSubscriptionsService.seats(target!),
		enabled: !!target,
		retry: 1,
		staleTime: 15_000
	})
	const history = useQuery({
		queryKey: [...rootKey, 'seats-history', target, historyPage],
		queryFn: () =>
			adminCrmSubscriptionsService.seatsHistory(target!, historyPage, 10),
		enabled: !!target,
		retry: 1
	})
	const invalidate = () => {
		void client.invalidateQueries({ queryKey: rootKey })
		void client.invalidateQueries({ queryKey: ['admin-event-log'] })
		void client.invalidateQueries({ queryKey: ['get-profile'] })
	}
	const accept = (result: CrmAdminSeatsResult) => {
		clearResolvedCrmAdminSeats(actorSubject, result.commandId)
		if (mounted.current) {
			setRecovery({ pending: null, storageError: false })
			setConfirmation(null)
		}
		invalidate()
		return `Количество мест изменено: ${result.adjustment.oldTotalSeats} → ${result.adjustment.newTotalSeats}`
	}
	const acceptProof = (proof: CrmAdminSeatsRecovery) => {
		if (proof.outcome === 'COMMITTED') return accept(proof.result)
		clearResolvedCrmAdminSeats(actorSubject, proof.commandId)
		if (mounted.current)
			setRecovery({ pending: null, storageError: false })
		invalidate()
		return 'Запрос отменён. Количество мест по нему не изменено.'
	}
	const execute = async (
		destination: string,
		command: CrmAdminSeatsCommand,
		replay: boolean
	) => {
		if (
			!online ||
			inFlight.current ||
			forbidden ||
			recovery.storageError ||
			(!replay && externalLocked)
		)
			return
		inFlight.current = true
		setBusy(true)
		let sent = false
		const id = toast.loading('Пожалуйста, подождите')
		try {
			const retained = retainPendingCrmAdminSeats(
				actorSubject,
				destination,
				command
			)
			setRecovery({ pending: retained, storageError: false })
			setConfirmation(null)
			sent = true
			const result = await adminCrmSubscriptionsService.setSeats(
				destination,
				actorSubject,
				retained.command!
			)
			const message = accept(result)
			if (mounted.current) toast.success(message, { id })
			else toast.dismiss(id)
		} catch (error) {
			if (!mounted.current) {
				toast.dismiss(id)
				return
			}
			if (!sent) {
				setRecovery(current => ({ ...current, storageError: true }))
				toast.error(
					'Не удалось сохранить отметку запроса. Изменение не отправлено.',
					{ id }
				)
			} else if (error instanceof CrmAdminGrantNotSentError) {
				setForbidden(true)
				if (!replay) {
					try {
						clearResolvedCrmAdminSeats(actorSubject, command.commandId)
						setRecovery({ pending: null, storageError: false })
					} catch {
						setRecovery(current => ({ ...current, storageError: true }))
					}
				}
				toast.error(
					'Вход изменился. Обновите авторизацию, затем проверьте результат запроса.',
					{ id }
				)
			} else {
				const status = axios.isAxiosError(error)
					? error.response?.status
					: null
				const code: unknown = axios.isAxiosError(error)
					? error.response?.data?.code
					: null
				if (status === 401 || status === 403) setForbidden(true)
				// Even a conflict can follow a durable capacity reservation. Only terminal proof clears it.
				toast.error(
					typeof code === 'string' && BLOCKED[code]
						? `${BLOCKED[code]} Проверьте результат этой попытки.`
						: 'Результат пока не подтверждён. Проверьте этот запрос перед новым изменением.',
					{ id }
				)
			}
		} finally {
			inFlight.current = false
			if (mounted.current) setBusy(false)
		}
	}
	const recover = async (cancel: boolean) => {
		if (!pending || !online || inFlight.current || forbidden) return
		inFlight.current = true
		setBusy(true)
		setCancelConfirmation(false)
		const id = toast.loading('Пожалуйста, подождите')
		try {
			const proof = await (
				cancel
					? adminCrmSubscriptionsService.cancelSeatsCommand
					: adminCrmSubscriptionsService.seatsCommand
			)(pending.workspaceId, pending.commandId, actorSubject)
			const message = acceptProof(proof)
			if (mounted.current) toast.success(message, { id })
			else toast.dismiss(id)
		} catch {
			if (mounted.current)
				toast.error(
					'Сервер пока не подтвердил результат. Отметка запроса сохранена.',
					{ id }
				)
			else toast.dismiss(id)
		} finally {
			inFlight.current = false
			if (mounted.current) setBusy(false)
		}
	}
	if (!target && !recovery.storageError) return null
	return (
		<section
			className={styles.detail}
			aria-label="Количество мест в подписке"
		>
			<h4 className={common.sectionTitle}>Количество мест</h4>
			<p className={common.accessNote}>
				Изменение действует на текущий период без изменения его срока и без
				оплаты. В число мест входит владелец.
			</p>
			{target && (
				<p className={styles.identifier}>Пространство: {target}</p>
			)}
			{recovery.storageError && (
				<p className={common.errorState} role="alert">
					Не удалось прочитать или сохранить отметку запроса. Новые
					изменения заблокированы. Проверьте историю, не очищая данные
					браузера.
				</p>
			)}
			{forbidden && (
				<p className={common.errorState} role="alert">
					Авторизация изменилась. Обновите вход для продолжения.
				</p>
			)}
			{pending && (
				<div className={common.staleState} role="status">
					<p>
						Проверьте предыдущее изменение мест, прежде чем отправлять
						новое.
					</p>
					<div className={styles.actions}>
						<button
							type="button"
							className={common.refreshButton}
							disabled={busy || !online || forbidden}
							onClick={() => void recover(false)}
						>
							Проверить результат
						</button>
						{pending.command && (
							<button
								type="button"
								className={common.refreshButton}
								disabled={
									busy || !online || forbidden || recovery.storageError
								}
								onClick={() =>
									void execute(pending.workspaceId, pending.command!, true)
								}
							>
								Повторить запрос
							</button>
						)}
						<button
							type="button"
							className={common.refreshButton}
							disabled={busy || !online || forbidden}
							onClick={() => setCancelConfirmation(true)}
						>
							Отменить неподтверждённый запрос
						</button>
					</div>
				</div>
			)}
			{target && (
				<>
					<button
						type="button"
						className={common.refreshButton}
						disabled={busy || !online || context.isFetching}
						onClick={async () => {
							const id = toast.loading('Пожалуйста, подождите')
							const results = await Promise.all([
								context.refetch(),
								history.refetch()
							])
							if (!mounted.current) toast.dismiss(id)
							else if (results.some(result => result.isError))
								toast.error('Не удалось обновить данные мест', { id })
							else toast.success('Данные мест обновлены', { id })
						}}
					>
						Обновить данные мест
					</button>
					{context.isLoading ? (
						<p role="status">Пожалуйста, подождите</p>
					) : context.isError || !context.data ? (
						<p className={common.errorState} role="alert">
							Не удалось проверить доступные и занятые места. Изменение
							пока недоступно.
						</p>
					) : (
						<SeatsForm
							key={`${target}:${context.data.subscription.entitlementVersion}:${context.data.subscription.billingVersion}`}
							context={context.data}
							locked={
								locked || externalLocked || !online || context.isFetching
							}
							onPrepare={(total, reason) => {
								if (
									locked ||
									externalLocked ||
									!online ||
									context.isFetching ||
									!context.data
								)
									return
								try {
									setConfirmation({
										context: context.data,
										command: createCrmAdminSeatsCommand(
											context.data,
											total,
											reason,
											crypto.randomUUID(),
											actorSubject
										)
									})
								} catch {
									toast.error(
										'Проверьте количество мест и причину изменения'
									)
								}
							}}
						/>
					)}
					<h5 className={common.sectionTitle}>История изменения мест</h5>
					{history.isError ? (
						<p className={common.errorState}>
							Не удалось загрузить историю.
						</p>
					) : history.isLoading ? (
						<p role="status">Пожалуйста, подождите</p>
					) : history.data?.items.length ? (
						history.data.items.map(item => (
							<article className={styles.historyItem} key={item.commandId}>
								<strong>
									{item.oldTotalSeats} → {item.newTotalSeats} мест
								</strong>
								<p>Причина: {item.reason}</p>
								<p>
									{formatDate(item.createdAt)} МСК · Исполнитель:{' '}
									{item.actorSubject}
								</p>
								<p>
									Срок сохранён: до {formatDate(item.effectiveUntil)} МСК
								</p>
							</article>
						))
					) : (
						<p className={common.accessNote}>Изменений пока нет.</p>
					)}
					{history.data && history.data.total > 10 && (
						<nav
							className={styles.pager}
							aria-label="Страницы истории изменения мест"
						>
							<button
								type="button"
								className={common.refreshButton}
								disabled={historyPage === 1 || history.isFetching}
								onClick={() => setHistoryPage(page => page - 1)}
							>
								Назад
							</button>
							<span>
								Страница {historyPage} · Всего: {history.data.total}
							</span>
							<button
								type="button"
								className={common.refreshButton}
								disabled={
									historyPage * 10 >= history.data.total ||
									history.isFetching
								}
								onClick={() => setHistoryPage(page => page + 1)}
							>
								Далее
							</button>
						</nav>
					)}
				</>
			)}
			{confirmation && (
				<ConfirmDialog
					title="Изменить количество мест?"
					message={`Количество мест: ${confirmation.context.subscription.entitlement.seatLimit} → ${confirmation.command.totalSeats}. Пространство: ${confirmation.context.subscription.workspaceId}. Срок подписки сохранится. Оплата не создаётся.`}
					confirmLabel="Изменить места"
					confirmDisabled={locked || externalLocked || !online}
					onCancel={() => setConfirmation(null)}
					onConfirm={() =>
						void execute(
							confirmation.context.subscription.workspaceId,
							confirmation.command,
							false
						)
					}
				>
					<p className={styles.confirmReason}>
						Причина: {confirmation.command.reason}
					</p>
				</ConfirmDialog>
			)}
			{cancelConfirmation && pending && (
				<ConfirmDialog
					title="Отменить неподтверждённый запрос?"
					message="Сервер проверит результат: сохранённое изменение останется в силе. Если изменение ещё не применено, этот запрос будет окончательно отменён."
					confirmLabel="Проверить и отменить"
					confirmDisabled={busy || !online || forbidden}
					onCancel={() => setCancelConfirmation(false)}
					onConfirm={() => void recover(true)}
				/>
			)}
		</section>
	)
}

function SeatsForm({
	context,
	locked,
	onPrepare
}: {
	context: CrmAdminSeatsContext
	locked: boolean
	onPrepare: (total: string, reason: string) => void
}) {
	const [total, setTotal] = useState(
		String(context.subscription.entitlement.seatLimit ?? '')
	)
	const [reason, setReason] = useState('')
	const seatsHintId = useId()
	const value = Number(total)
	const seatsError =
		total !== '' &&
		(!/^\d+$/.test(total.trim()) || !Number.isSafeInteger(value))
			? 'Укажите целое количество мест.'
			: total !== '' && value < context.capacity.minimumSeats
				? `Нельзя установить меньше ${context.capacity.minimumSeats} мест: учитываются минимум тарифа и занятые места вместе с владельцем.`
				: value > context.capacity.maximumSeats
					? `Можно установить не больше ${context.capacity.maximumSeats} мест.`
					: null
	const valid =
		/^\d+$/.test(total.trim()) &&
		Number.isSafeInteger(value) &&
		value >= context.capacity.minimumSeats &&
		value <= context.capacity.maximumSeats &&
		value !== context.subscription.entitlement.seatLimit &&
		reason.trim().length >= 3 &&
		reason.trim().length <= 1000
	return (
		<>
			<p>
				Сейчас мест: {context.subscription.entitlement.seatLimit ?? '—'}.
				Занято: {context.capacity.usedSeats}, включая владельца. Минимум:{' '}
				{context.capacity.minimumSeats}.
			</p>
			{context.blockedReason && (
				<p className={common.staleState} role="status">
					{BLOCKED[context.blockedReason] ??
						'Изменение мест сейчас недоступно. Проверьте состояние подписки.'}
				</p>
			)}
			<form
				className={styles.grantForm}
				onSubmit={event => {
					event.preventDefault()
					if (!locked && context.canSetSeats && valid)
						onPrepare(total, reason)
				}}
			>
				<fieldset
					className={styles.fields}
					disabled={locked || !context.canSetSeats}
				>
					<legend className={common.srOnly}>
						Изменить количество мест
					</legend>
					<label className={common.pricingField}>
						Всего мест, включая владельца
						<input
							type="number"
							step={1}
							inputMode="numeric"
							min={context.capacity.minimumSeats}
							max={context.capacity.maximumSeats}
							value={total}
							aria-invalid={!!seatsError}
							aria-describedby={seatsError ? seatsHintId : undefined}
							onChange={event => setTotal(event.target.value)}
						/>
						{seatsError && (
							<span
								id={seatsHintId}
								className={common.errorState}
								role="alert"
							>
								{seatsError}
							</span>
						)}
					</label>
					<label className={styles.reason}>
						Причина изменения
						<textarea
							minLength={3}
							maxLength={1000}
							rows={3}
							value={reason}
							onChange={event => setReason(event.target.value)}
							placeholder="Например, индивидуальные условия для клиента"
						/>
					</label>
				</fieldset>
				<button
					type="submit"
					className={common.saveButton}
					disabled={locked || !context.canSetSeats || !valid}
				>
					Изменить количество мест
				</button>
			</form>
		</>
	)
}
