'use client'

import {
	UserRole,
	useAuthStore,
	useUser,
	userService
} from '@/entities/user'
import {
	adminCrmSubscriptionsService,
	bindCrmAdminGrantActor,
	clearResolvedCrmAdminGrant,
	CrmAdminGrantNotSentError,
	createCrmAdminGrantCommand,
	readPendingCrmAdminGrant,
	retainPendingCrmAdminGrant,
	type CrmAdminGrantCommand,
	type CrmAdminCommandRecovery,
	type CrmAdminGrantResult,
	type CrmAdminSubscription,
	type PendingCrmAdminGrant
} from '@/features/admin-crm'
import { CRM_RELEASE } from '@/shared/config/crm-release.config'
import ConfirmDialog from '@/shared/ui/confirm-dialog/ConfirmDialog'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import {
	onlineManager,
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import axios from 'axios'
import {
	type FormEvent,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore
} from 'react'
import toast from 'react-hot-toast'
import common from './AdminCrm.module.scss'
import styles from './CrmSubscriptionAdmin.module.scss'

const PAGE_SIZE = 10
const ROOT_KEY = ['admin-crm-subscriptions'] as const
const subscribeOnline = (callback: () => void) =>
	onlineManager.subscribe(callback)
const getOnline = () =>
	onlineManager.isOnline() &&
	(typeof navigator === 'undefined' || navigator.onLine)
const getServerOnline = () => false
const formatter = new Intl.DateTimeFormat('ru-RU', {
	dateStyle: 'medium',
	timeStyle: 'short',
	timeZone: 'Europe/Moscow'
})
const formatDate = (value: string | null) =>
	value ? `${formatter.format(new Date(value))} МСК` : '—'
const STATUS_LABELS: Record<string, string> = {
	ACTIVE: 'Доступ активен',
	GRACE: 'Льготный период',
	READ_ONLY: 'Только просмотр',
	SUSPENDED: 'Доступ приостановлен',
	EXPIRED: 'Срок истёк',
	CANCELLED: 'Отменена'
}
const RENEWAL_LABELS: Record<string, string> = {
	ACTIVE: 'Включено',
	USER_DISABLED: 'Отключено владельцем',
	TECHNICAL_PAUSE: 'Техническая пауза',
	PRICE_CONFIRMATION_REQUIRED: 'Ожидает подтверждения цены',
	REVOKED: 'Согласие отозвано'
}
const BLOCKED_LABELS: Record<string, string> = {
	crm_admin_subscription_suspended:
		'Подписка приостановлена или отменена. Начисление дней не снимает ограничение доступа.',
	crm_admin_subscription_operation_pending:
		'Сначала дождитесь завершения текущей операции оплаты или изменения подписки.',
	crm_admin_subscription_capacity_pending:
		'Сначала дождитесь завершения изменения числа сотрудников.',
	crm_admin_subscription_version_limit:
		'Достигнут технический предел версии подписки. Требуется проверка разработчиком.',
	crm_admin_subscription_policy_invalid:
		'Не удалось подтвердить настройки оплаченного периода. Требуется проверка разработчиком.'
}
const TERMINAL_CONFLICTS = new Set([
	'crm_admin_subscription_version_conflict',
	...Object.keys(BLOCKED_LABELS)
])

export default function CrmSubscriptionAdmin() {
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading } = useUser()
	const canView = Boolean(
		isAuthResolved &&
		auth &&
		!isLoading &&
		user.id &&
		user.rights?.some(
			role => role === UserRole.ADMIN || role === UserRole.DEV
		)
	)
	return (
		<section
			className={common.section}
			aria-labelledby="crm-subscriptions-title"
		>
			<div className={common.sectionHeader}>
				<div>
					<h3 id="crm-subscriptions-title" className={common.sectionTitle}>
						Подписки aeroCRM
					</h3>
					<p className={common.sectionHint}>
						Бесплатное начисление дней клиенту или собственной CRM. Цены и
						подписки aeroCRM не меняются.
					</p>
				</div>
				<AdminTooltip
					title="Ручное продление aeroCRM"
					description="ADMIN и DEV сервиса могут начислять дни, в том числе себе. Причина, прежний и новый срок, исполнитель и рабочее пространство записываются в Журнал событий. Оплата и согласие на автосписания не создаются."
					risk="medium"
				/>
			</div>
			{!CRM_RELEASE.apiEnabled ? (
				<p className={common.accessNote}>
					Управление подписками подключится после выпуска API aeroCRM.
				</p>
			) : !isAuthResolved || isLoading ? (
				<p role="status">Проверяем доступ...</p>
			) : !canView ? (
				<p className={common.accessNote}>
					Просмотр и начисление дней доступны ADMIN и DEV сервиса.
				</p>
			) : (
				<SubscriptionManager
					key={user.id}
					actorSubject={user.id}
					actorLabel={user.name || user.email || 'Моя CRM'}
				/>
			)}
		</section>
	)
}

function SubscriptionManager({
	actorSubject,
	actorLabel
}: {
	actorSubject: string
	actorLabel: string
}) {
	const queryClient = useQueryClient()
	const online = useSyncExternalStore(
		subscribeOnline,
		getOnline,
		getServerOnline
	)
	const [recovery, setRecovery] = useState<{
		pending: PendingCrmAdminGrant | null
		storageError: boolean
	}>(() => {
		try {
			bindCrmAdminGrantActor(actorSubject)
			return {
				pending: readPendingCrmAdminGrant(actorSubject),
				storageError: false
			}
		} catch {
			return { pending: null, storageError: true }
		}
	})
	const pending = recovery.pending
	const [owner, setOwner] = useState<{
		subject: string
		label: string
	} | null>(null)
	const [searchDraft, setSearchDraft] = useState('')
	const [search, setSearch] = useState('')
	const [userPage, setUserPage] = useState(1)
	const [page, setPage] = useState(1)
	const [workspaceId, setWorkspaceId] = useState<string | null>(
		pending?.workspaceId ?? null
	)
	const [historyPage, setHistoryPage] = useState(1)
	const [days, setDays] = useState('7')
	const [reason, setReason] = useState('')
	const [confirmation, setConfirmation] = useState<{
		command: CrmAdminGrantCommand
		subscription: CrmAdminSubscription
	} | null>(null)
	const [checking, setChecking] = useState(false)
	const [cancelConfirmation, setCancelConfirmation] = useState(false)
	const [forbidden, setForbidden] = useState(false)
	const inFlight = useRef(false)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const baseKey = [...ROOT_KEY, actorSubject]
	const list = useQuery({
		queryKey: [...baseKey, 'list', owner?.subject ?? '', page],
		queryFn: () =>
			adminCrmSubscriptionsService.list(page, PAGE_SIZE, owner?.subject),
		retry: 1,
		staleTime: 30_000
	})
	const userSearch = useQuery({
		queryKey: [...baseKey, 'owner-search', search, userPage],
		queryFn: () => userService.fetchUserList(search, userPage, PAGE_SIZE),
		select: result => result.data,
		enabled: search.length >= 2,
		retry: 1
	})
	const detail = useQuery({
		queryKey: [...baseKey, 'detail', workspaceId],
		queryFn: () => adminCrmSubscriptionsService.detail(workspaceId!),
		enabled: !!workspaceId,
		retry: 1,
		staleTime: 15_000
	})
	const history = useQuery({
		queryKey: [...baseKey, 'history', workspaceId, historyPage],
		queryFn: () =>
			adminCrmSubscriptionsService.history(
				workspaceId!,
				historyPage,
				PAGE_SIZE
			),
		enabled: !!workspaceId,
		retry: 1
	})
	const mutation = useMutation({
		mutationKey: [...baseKey, 'extend-days'],
		mutationFn: ({
			target,
			command
		}: {
			target: string
			command: CrmAdminGrantCommand
		}) =>
			adminCrmSubscriptionsService.extendDays(
				target,
				actorSubject,
				command
			),
		retry: false,
		networkMode: 'always'
	})
	const busy = mutation.isPending || checking
	const locked = !!pending || recovery.storageError || forbidden || busy
	const subscription = detail.data
	const daysNumber = Number(days)
	const validDraft =
		/^\d+$/.test(days.trim()) &&
		Number.isInteger(daysNumber) &&
		daysNumber >= 1 &&
		daysNumber <= 3650 &&
		reason.trim().length >= 3 &&
		reason.trim().length <= 1000
	const canCreate =
		!!subscription &&
		!detail.isError &&
		!detail.isFetching &&
		!subscription.blockedReason &&
		!locked &&
		online &&
		validDraft

	const refresh = async () => {
		if (!online || busy) return
		const id = toast.loading('Обновляем подписки aeroCRM...')
		const results = await Promise.all([
			list.refetch(),
			...(workspaceId ? [detail.refetch(), history.refetch()] : [])
		])
		if (!mounted.current) {
			toast.dismiss(id)
			return
		}
		if (results.some(result => result.isError))
			toast.error('Не удалось обновить все данные подписки', { id })
		else toast.success('Подписки aeroCRM обновлены', { id })
	}
	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: baseKey })
		void queryClient.invalidateQueries({ queryKey: ['get-profile'] })
		void queryClient.invalidateQueries({ queryKey: ['admin-event-log'] })
	}
	const acceptResult = (result: CrmAdminGrantResult) => {
		clearResolvedCrmAdminGrant(actorSubject, result.commandId)
		if (mounted.current) {
			setRecovery({ pending: null, storageError: false })
			setConfirmation(null)
			setDays('7')
			setReason('')
		}
		invalidate()
	}
	const acceptRecovery = (proof: CrmAdminCommandRecovery) => {
		if (proof.outcome === 'COMMITTED') {
			acceptResult(proof.result)
			return `Начисление подтверждено: ${proof.result.grant.days} дней`
		}
		clearResolvedCrmAdminGrant(actorSubject, proof.commandId)
		if (mounted.current) {
			setRecovery({ pending: null, storageError: false })
			setCancelConfirmation(false)
			setConfirmation(null)
		}
		invalidate()
		return 'Команда отменена. Дни по ней не начислены; повторное выполнение заблокировано сервером.'
	}
	const execute = async (
		target: string,
		command: CrmAdminGrantCommand,
		replay: boolean
	) => {
		if (!online || inFlight.current || forbidden || recovery.storageError)
			return
		inFlight.current = true
		let id: string | undefined
		let sent = false
		try {
			const retained = retainPendingCrmAdminGrant(
				actorSubject,
				target,
				command
			)
			setRecovery({ pending: retained, storageError: false })
			setConfirmation(null)
			id = toast.loading(
				replay
					? 'Проверяем ту же попытку начисления...'
					: 'Начисляем дни aeroCRM...'
			)
			sent = true
			const result = await mutation.mutateAsync({
				target,
				command: retained.command!
			})
			acceptResult(result)
			if (mounted.current)
				toast.success(
					`Начислено ${result.grant.days} дней. Новый срок: ${formatDate(result.grant.newExpiresAt)}`,
					{ id }
				)
			else toast.dismiss(id)
		} catch (error) {
			if (!mounted.current) {
				if (id) toast.dismiss(id)
				return
			}
			if (!sent) {
				setRecovery(current => ({ ...current, storageError: true }))
				toast.error(
					'Не удалось сохранить безопасную отметку запроса. Начисление не отправлено.',
					{ id }
				)
				return
			}
			if (error instanceof CrmAdminGrantNotSentError) {
				setForbidden(true)
				if (!replay) {
					try {
						clearResolvedCrmAdminGrant(actorSubject, command.commandId)
						setRecovery({ pending: null, storageError: false })
					} catch {
						setRecovery(current => ({ ...current, storageError: true }))
					}
				}
				toast.error(
					replay
						? 'Авторизация изменилась. Повторная отправка не выполнена; прежний результат проверьте после входа.'
						: 'Авторизация изменилась или истекла. Начисление не отправлено. Обновите вход перед новой попыткой.',
					{ id }
				)
				return
			}
			const status = axios.isAxiosError(error)
				? error.response?.status
				: null
			const code = axios.isAxiosError(error)
				? error.response?.data?.code
				: null
			if (
				!replay &&
				typeof code === 'string' &&
				((status === 409 && TERMINAL_CONFLICTS.has(code)) ||
					(status === 400 &&
						code === 'crm_admin_subscription_date_out_of_range'))
			) {
				try {
					clearResolvedCrmAdminGrant(actorSubject, command.commandId)
					setRecovery({ pending: null, storageError: false })
				} catch {
					setRecovery(current => ({ ...current, storageError: true }))
				}
				invalidate()
				toast.error(
					'Начисление отклонено: подписка изменилась или сейчас недоступна. Обновите данные и проверьте срок.',
					{ id }
				)
			} else {
				if (status === 401 || status === 403) {
					setForbidden(true)
					void queryClient.invalidateQueries({ queryKey: ['get-profile'] })
				}
				toast.error(
					'Результат начисления пока не подтверждён. Новое начисление заблокировано; проверьте эту попытку.',
					{ id }
				)
			}
		} finally {
			inFlight.current = false
		}
	}
	const checkResult = async () => {
		if (!pending || !online || inFlight.current || forbidden) return
		inFlight.current = true
		setChecking(true)
		const id = toast.loading('Проверяем результат начисления...')
		try {
			const result = await adminCrmSubscriptionsService.command(
				pending.workspaceId,
				pending.commandId,
				actorSubject
			)
			const message = acceptRecovery(result)
			if (mounted.current) toast.success(message, { id })
			else toast.dismiss(id)
		} catch {
			if (mounted.current)
				toast.error(
					'Подтверждение пока не получено. Это не означает, что дни не начислены. Новое начисление остаётся заблокированным.',
					{ id }
				)
			else toast.dismiss(id)
		} finally {
			inFlight.current = false
			if (mounted.current) setChecking(false)
		}
	}
	const cancelUnknown = async () => {
		if (
			!pending ||
			pending.command ||
			!online ||
			inFlight.current ||
			forbidden
		)
			return
		inFlight.current = true
		setChecking(true)
		setCancelConfirmation(false)
		const id = toast.loading(
			'Проверяем и отменяем неподтверждённую команду...'
		)
		try {
			const proof = await adminCrmSubscriptionsService.cancelCommand(
				pending.workspaceId,
				pending.commandId,
				actorSubject
			)
			const message = acceptRecovery(proof)
			if (mounted.current) toast.success(message, { id })
			else toast.dismiss(id)
		} catch {
			if (mounted.current)
				toast.error(
					'Сервер не подтвердил отмену или начисление. Отметка сохранена; проверьте результат этой же команды.',
					{ id }
				)
			else toast.dismiss(id)
		} finally {
			inFlight.current = false
			if (mounted.current) setChecking(false)
		}
	}
	const prepare = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!canCreate || !subscription) return
		try {
			setConfirmation({
				subscription,
				command: createCrmAdminGrantCommand(
					subscription,
					days,
					reason,
					window.crypto.randomUUID(),
					actorSubject
				)
			})
		} catch {
			toast.error(
				'Укажите от 1 до 3650 дней и причину от 3 до 1000 символов'
			)
		}
	}
	const chooseOwner = (subject: string, label: string) => {
		if (busy) return
		setOwner({ subject, label })
		setPage(1)
		setWorkspaceId(null)
		setSearch('')
		setSearchDraft('')
		setConfirmation(null)
	}
	return (
		<div className={styles.content}>
			<div className={styles.actions}>
				<button
					type="button"
					className={common.refreshButton}
					disabled={busy || !online}
					onClick={() => chooseOwner(actorSubject, actorLabel)}
				>
					Моя CRM
				</button>
				<button
					type="button"
					className={common.refreshButton}
					disabled={busy || !owner}
					onClick={() => {
						setOwner(null)
						setPage(1)
						setWorkspaceId(null)
					}}
				>
					Все владельцы
				</button>
				<button
					type="button"
					className={common.refreshButton}
					disabled={busy || !online || list.isFetching}
					onClick={() => void refresh()}
				>
					Обновить подписки
				</button>
			</div>
			{!online && (
				<p className={common.staleState} role="status">
					Нет подключения к сети. Начисление не отправляется автоматически
					после восстановления связи.
				</p>
			)}
			{recovery.storageError && (
				<p className={common.errorState} role="alert">
					Не удалось прочитать или сохранить отметку предыдущего запроса.
					Новые начисления заблокированы. Не очищайте данные браузера:
					сначала проверьте историю начислений.
				</p>
			)}
			{forbidden && (
				<p className={common.errorState} role="alert">
					Сервер не подтвердил доступ ADMIN или DEV. Повторно войдите в
					аккаунт с нужными правами; отметка запроса сохранена.
				</p>
			)}
			{pending && (
				<div className={common.staleState} role="status">
					<strong>
						Результат предыдущего начисления пока не подтверждён
					</strong>
					<p>
						Новое начисление недоступно, пока сервер не подтвердит
						результат. Перезагрузка и отсутствие записи в первых строках
						истории не означают отмену запроса.
					</p>
					<p className={styles.identifier}>
						Пространство: {pending.workspaceId}
						<br />
						Запрос: {pending.commandId}
					</p>
					<div className={styles.actions}>
						<button
							type="button"
							className={common.refreshButton}
							disabled={busy || !online || forbidden}
							onClick={() => void checkResult()}
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
								Повторить ту же попытку
							</button>
						)}
						{!pending.command && (
							<button
								type="button"
								className={common.refreshButton}
								disabled={busy || !online || forbidden}
								onClick={() => setCancelConfirmation(true)}
							>
								Отменить неподтверждённую команду
							</button>
						)}
					</div>
				</div>
			)}
			<form
				className={styles.search}
				onSubmit={event => {
					event.preventDefault()
					if (!busy && searchDraft.trim().length >= 2) {
						setSearch(searchDraft.trim())
						setUserPage(1)
					}
				}}
			>
				<label className={common.pricingField}>
					Найти владельца по имени или email
					<input
						value={searchDraft}
						onChange={event => setSearchDraft(event.target.value)}
						placeholder="Имя или email клиента"
						maxLength={200}
						disabled={busy}
					/>
				</label>
				<button
					type="submit"
					className={common.refreshButton}
					disabled={busy || !online || searchDraft.trim().length < 2}
				>
					Найти владельца
				</button>
			</form>
			{search && (
				<div
					className={styles.searchResults}
					aria-label="Найденные владельцы"
				>
					{userSearch.isLoading ? (
						<p role="status">Ищем пользователей...</p>
					) : userSearch.isError ? (
						<p role="alert">
							Не удалось найти пользователей. Повторите поиск.
						</p>
					) : (
						<>
							{userSearch.data?.items.length === 0 && (
								<p>Пользователи не найдены.</p>
							)}
							{userSearch.data?.items.map(item => (
								<button
									type="button"
									key={item.id}
									className={styles.ownerButton}
									disabled={busy}
									onClick={() =>
										chooseOwner(
											item.id,
											item.name || item.email || item.id
										)
									}
								>
									<strong>{item.name || 'Без имени'}</strong>
									<span>{item.email || item.id}</span>
								</button>
							))}
							{userSearch.data && (
								<ServerPager
									label="Страницы владельцев"
									page={userPage}
									total={userSearch.data.total}
									disabled={userSearch.isFetching || busy}
									onChange={setUserPage}
								/>
							)}
						</>
					)}
				</div>
			)}
			<p className={styles.caption}>
				{owner ? `Владелец: ${owner.label}` : 'Все подписки aeroCRM'}
			</p>
			{list.isLoading ? (
				<p role="status">Загружаем подписки...</p>
			) : list.isError ? (
				<p className={common.errorState} role="alert">
					Не удалось загрузить подписки aeroCRM. Обновите данные.
				</p>
			) : (
				<>
					{list.data?.items.length === 0 && (
						<p className={common.accessNote}>
							Подписки aeroCRM не найдены. Начисление дней не создаёт
							рабочее пространство и не запускает Trial вместо владельца.
						</p>
					)}
					<div className={styles.workspaceList}>
						{list.data?.items.map(item => (
							<button
								type="button"
								key={item.workspaceId}
								className={styles.workspaceButton}
								aria-pressed={workspaceId === item.workspaceId}
								disabled={busy}
								onClick={() => {
									setWorkspaceId(item.workspaceId)
									setHistoryPage(1)
									setConfirmation(null)
									setReason('')
								}}
							>
								<strong>
									{item.entitlement.planCode === 'TRIAL'
										? 'Пробный доступ'
										: 'Подписка aeroCRM'}{' '}
									·{' '}
									{STATUS_LABELS[item.entitlement.status] ??
										item.entitlement.status}
								</strong>
								<span>
									До {formatDate(item.entitlement.effectiveUntil)} · Мест:{' '}
									{item.entitlement.seatLimit ?? '—'}
								</span>
								<span className={styles.identifier}>
									Пространство: {item.workspaceId}
								</span>
								{!owner && (
									<span className={styles.identifier}>
										Владелец: {item.ownerSubject}
									</span>
								)}
							</button>
						))}
					</div>
					{list.data && (
						<ServerPager
							label="Страницы подписок CRM"
							page={page}
							total={list.data.total}
							disabled={list.isFetching || busy}
							onChange={setPage}
						/>
					)}
				</>
			)}
			{workspaceId && (
				<section
					className={styles.detail}
					aria-label="Выбранная подписка aeroCRM"
				>
					<h4 className={common.sectionTitle}>Управление подпиской</h4>
					<p className={styles.identifier}>{workspaceId}</p>
					{detail.isLoading ? (
						<p role="status">Загружаем состояние...</p>
					) : detail.isError || !subscription ? (
						<p className={common.errorState} role="alert">
							Актуальное состояние недоступно. Начисление заблокировано до
							обновления.
						</p>
					) : (
						<>
							<dl className={common.pricingSummary}>
								<div>
									<dt>Состояние</dt>
									<dd>
										{STATUS_LABELS[subscription.entitlement.status] ??
											subscription.entitlement.status}
									</dd>
								</div>
								<div>
									<dt>Доступ до</dt>
									<dd>
										{formatDate(subscription.entitlement.effectiveUntil)}
									</dd>
								</div>
								<div>
									<dt>Число сотрудников</dt>
									<dd>{subscription.entitlement.seatLimit ?? '—'}</dd>
								</div>
								<div>
									<dt>Куда добавляем дни</dt>
									<dd>
										{subscription.extensionTarget === 'PAID_PERIOD'
											? 'Оплаченный период'
											: 'Текущий доступ'}
									</dd>
								</div>
								{subscription.period && (
									<>
										<div>
											<dt>Оплаченный период начинается</dt>
											<dd>{formatDate(subscription.period.startsAt)}</dd>
										</div>
										<div>
											<dt>Оплаченный период заканчивается</dt>
											<dd>{formatDate(subscription.period.expiresAt)}</dd>
										</div>
									</>
								)}
								{subscription.renewal && (
									<div>
										<dt>Автопродление</dt>
										<dd>
											{RENEWAL_LABELS[subscription.renewal.status] ??
												subscription.renewal.status}
										</dd>
										<dt>Расчётная дата следующего периода</dt>
										<dd>
											{formatDate(subscription.renewal.nextChargeAt)}
										</dd>
									</div>
								)}
							</dl>
							<p className={common.accessNote}>
								Дни добавятся к концу выбранного периода; если он истёк — к
								моменту начисления. Стоимость, число мест и согласие на
								автосписания не меняются. Будущий оплаченный период
								сохраняет дату начала после Trial. Дата автопродления
								сдвигается вслед за сроком; отключённое автопродление не
								включается.
							</p>
							{subscription.blockedReason && (
								<p className={common.staleState} role="status">
									{BLOCKED_LABELS[subscription.blockedReason] ??
										'Начисление сейчас недоступно. Проверьте состояние подписки.'}
								</p>
							)}
							<form className={styles.grantForm} onSubmit={prepare}>
								<fieldset
									className={styles.fields}
									disabled={
										locked ||
										!online ||
										!!subscription.blockedReason ||
										detail.isFetching
									}
								>
									<legend className={common.srOnly}>
										Бесплатное начисление дней CRM
									</legend>
									<label className={common.pricingField}>
										Количество дней
										<input
											type="number"
											min={1}
											max={3650}
											step={1}
											inputMode="numeric"
											value={days}
											onChange={event => setDays(event.target.value)}
										/>
									</label>
									<label className={styles.reason}>
										Причина начисления
										<textarea
											value={reason}
											onChange={event => setReason(event.target.value)}
											minLength={3}
											maxLength={1000}
											rows={3}
											placeholder="Например, компенсация технического перерыва"
										/>
									</label>
								</fieldset>
								<button
									type="submit"
									className={common.saveButton}
									disabled={!canCreate}
								>
									Начислить дни aeroCRM
								</button>
							</form>
						</>
					)}
					<section
						className={styles.history}
						aria-label="История начислений aeroCRM"
					>
						<h4 className={common.sectionTitle}>История начислений</h4>
						{history.isLoading ? (
							<p role="status">Загружаем историю...</p>
						) : history.isError ? (
							<p className={common.errorState} role="alert">
								История начислений временно недоступна.
							</p>
						) : (
							<>
								{history.data?.items.length === 0 && (
									<p>Ручных начислений пока нет.</p>
								)}
								{history.data?.items.map(item => (
									<article
										className={styles.historyItem}
										key={item.commandId}
									>
										<strong>
											+{item.days} дней · {formatDate(item.createdAt)}
										</strong>
										<p>{item.reason}</p>
										<p>
											{formatDate(item.oldExpiresAt)} →{' '}
											{formatDate(item.newExpiresAt)}
										</p>
										<p className={styles.identifier}>
											Исполнитель: {item.actorSubject} ({item.actorRole})
											<br />
											Запрос: {item.commandId}
										</p>
									</article>
								))}
								{history.data && (
									<ServerPager
										label="Страницы истории CRM"
										page={historyPage}
										total={history.data.total}
										disabled={history.isFetching}
										onChange={setHistoryPage}
									/>
								)}
							</>
						)}
					</section>
				</section>
			)}
			{confirmation && (
				<ConfirmDialog
					title="Начислить бесплатные дни aeroCRM?"
					message={`Пространство ${confirmation.subscription.workspaceId}. Добавить ${confirmation.command.days} дней к ${confirmation.subscription.extensionTarget === 'PAID_PERIOD' ? 'оплаченному периоду' : 'текущему доступу'}. Текущий срок: ${formatDate(confirmation.subscription.period?.expiresAt ?? confirmation.subscription.entitlement.effectiveUntil)}. Денежного списания не будет.`}
					confirmLabel="Подтвердить начисление"
					confirmDisabled={!canCreate || busy}
					onCancel={() => setConfirmation(null)}
					onConfirm={() =>
						void execute(
							confirmation.subscription.workspaceId,
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
			{cancelConfirmation && pending && !pending.command && (
				<ConfirmDialog
					title="Отменить неподтверждённую команду?"
					message={`Пространство ${pending.workspaceId}. Запрос ${pending.commandId}. Сервер сначала проверит результат: если дни уже начислены, покажет исходное начисление. Иначе окончательно запретит выполнение этой команды. Подтверждённые начисления не отменяются.`}
					confirmLabel="Отменить команду"
					confirmDisabled={busy || !online || forbidden}
					onCancel={() => setCancelConfirmation(false)}
					onConfirm={() => void cancelUnknown()}
				/>
			)}
		</div>
	)
}

function ServerPager({
	label,
	page,
	total,
	disabled,
	onChange
}: {
	label: string
	page: number
	total: number
	disabled: boolean
	onChange: (page: number) => void
}) {
	const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
	return (
		<nav className={styles.pager} aria-label={label}>
			<span>
				Всего: {total} · {page} / {lastPage}
			</span>
			<button
				type="button"
				className={common.refreshButton}
				disabled={disabled || page <= 1}
				onClick={() => onChange(page - 1)}
			>
				Назад
			</button>
			<button
				type="button"
				className={common.refreshButton}
				disabled={disabled || page >= lastPage}
				onClick={() => onChange(page + 1)}
			>
				Далее
			</button>
		</nav>
	)
}
