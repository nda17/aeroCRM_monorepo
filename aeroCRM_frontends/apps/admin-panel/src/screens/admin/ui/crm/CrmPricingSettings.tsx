'use client'

import { UserRole, useAuthStore, useUser } from '@/entities/user'
import {
	adminCrmService,
	CRM_PRICE_FIELDS,
	CRM_SEAT_FIELDS,
	createCrmPricingCommand,
	createCrmPricingDraft,
	parseCrmPricingDraft,
	type CrmPricingCommand,
	type CrmPricingDraft,
	type CrmPricingField,
	type CrmPricingSettings as PricingSettings
} from '@/features/admin-crm'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { CRM_RELEASE } from '@/shared/config/crm-release.config'
import {
	onlineManager,
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import axios from 'axios'
import {
	type FormEvent,
	useRef,
	useState,
	useSyncExternalStore
} from 'react'
import toast from 'react-hot-toast'
import styles from './AdminCrm.module.scss'

const PRICING_QUERY_KEY = ['admin-crm-pricing'] as const
const FIELD_LABELS: Record<CrmPricingField, string> = {
	monthlyPriceMinor: 'Стоимость за месяц, ₽',
	yearlyPriceMinor: 'Стоимость за год со скидкой 10%, ₽',
	additionalSeatMonthlyPriceMinor: 'Дополнительное место за месяц, ₽',
	additionalSeatYearlyPriceMinor: 'Дополнительное место за год, ₽',
	includedSeats: 'Включённых сотрудников сверх владельца',
	trialSeatLimit: 'Мест в бесплатном периоде'
}
const ALL_FIELDS = [...CRM_PRICE_FIELDS, ...CRM_SEAT_FIELDS]
const rubles = new Intl.NumberFormat('ru-RU', {
	style: 'currency',
	currency: 'RUB',
	maximumFractionDigits: 2
})
const subscribeOnline = (callback: () => void) =>
	onlineManager.subscribe(callback)
const getOnline = () =>
	onlineManager.isOnline() &&
	(typeof navigator === 'undefined' || navigator.onLine)
const getServerOnline = () => false

export default function CrmPricingSettings() {
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading: isUserLoading } = useUser()
	const canView = Boolean(
		isAuthResolved &&
		auth &&
		!isUserLoading &&
		user.rights?.some(
			role => role === UserRole.ADMIN || role === UserRole.DEV
		)
	)
	const canEdit = CRM_RELEASE.apiEnabled && canView
	const online = useSyncExternalStore(
		subscribeOnline,
		getOnline,
		getServerOnline
	)
	const queryKey = [...PRICING_QUERY_KEY, user.id]
	const isSaving =
		useIsMutating({
			mutationKey: [...queryKey, 'update']
		}) > 0
	const query = useQuery({
		queryKey,
		queryFn: adminCrmService.getPricingSettings,
		enabled: CRM_RELEASE.apiEnabled && canView,
		staleTime: 60_000,
		retry: 1
	})

	const reload = async (): Promise<PricingSettings | null> => {
		if (
			!CRM_RELEASE.apiEnabled ||
			!canView ||
			!online ||
			query.isFetching ||
			isSaving
		)
			return null
		const toastId = toast.loading('Загружаем тариф aeroCRM...')
		const result = await query.refetch()
		if (result.isError || !result.data) {
			toast.error('Не удалось загрузить тариф aeroCRM', { id: toastId })
			return null
		}
		toast.success('Тариф aeroCRM обновлён', { id: toastId })
		return result.data
	}

	return (
		<section
			className={styles.section}
			aria-labelledby="crm-pricing-title"
		>
			<div className={styles.sectionHeader}>
				<div>
					<h3 id="crm-pricing-title" className={styles.sectionTitle}>
						Тариф aeroCRM
					</h3>
					<p className={styles.sectionHint}>
						Месячная и годовая стоимость, включённые и дополнительные места
					</p>
				</div>
				<button
					type="button"
					className={styles.refreshButton}
					disabled={
						!CRM_RELEASE.apiEnabled ||
						!canView ||
						!online ||
						query.isFetching ||
						isSaving
					}
					onClick={() => void reload()}
				>
					{query.isFetching ? 'Обновляем...' : 'Обновить тариф'}
				</button>
			</div>

			{!CRM_RELEASE.apiEnabled ? (
				<p className={styles.accessNote}>
					Настройки цен и мест подключатся после выпуска aeroCRM. Бесплатный
					период — 10 дней, минимум два места с учётом владельца.
					Неопубликованные цены здесь не показываются.
				</p>
			) : !isAuthResolved ||
			  isUserLoading ||
			  (canView && query.isLoading) ? (
				<SkeletonLoader count={1} className={styles.pricingSkeleton} />
			) : !canView ? (
				<p className={styles.accessNote}>
					Просмотр тарифа доступен администраторам и разработчикам.
				</p>
			) : !query.data ? (
				<div className={styles.errorState} role="alert">
					<p className={styles.errorTitle}>Тариф пока недоступен</p>
					<p className={styles.errorText}>
						Загрузите настройки повторно. Сохранение доступно после
						успешной загрузки текущей версии.
					</p>
				</div>
			) : (
				<>
					{query.isError && (
						<p className={styles.staleState} role="alert">
							Показана последняя загруженная версия. Не удалось проверить
							актуальность тарифа; сохранение временно недоступно.
						</p>
					)}
					{!online && (
						<p className={styles.staleState} role="status">
							Нет подключения к сети. Сохранение станет доступно после
							восстановления соединения.
						</p>
					)}
					<dl className={styles.pricingSummary}>
						{ALL_FIELDS.map(field => (
							<div key={field}>
								<dt>{FIELD_LABELS[field].replace(', ₽', '')}</dt>
								<dd>
									{CRM_PRICE_FIELDS.some(price => price === field)
										? rubles.format(query.data[field] / 100)
										: query.data[field]}
								</dd>
							</div>
						))}
					</dl>
					<p className={styles.sectionHint}>
						Версия {query.data.version}. Владелец занимает одно место.
						Приглашения в ожидании и отключённые сотрудники места не
						занимают. Бесплатный период — {query.data.trialDays} дней,
						льготный период после него — {query.data.graceDays} дня.
					</p>
					<PricingEditor
						key={user.id}
						settings={query.data}
						queryKey={queryKey}
						canEdit={canEdit}
						canSubmit={
							canEdit && online && !query.isFetching && !query.isError
						}
						onReload={reload}
					/>
				</>
			)}
		</section>
	)
}

function PricingEditor({
	settings,
	queryKey,
	canEdit,
	canSubmit,
	onReload
}: {
	settings: PricingSettings
	queryKey: readonly unknown[]
	canEdit: boolean
	canSubmit: boolean
	onReload: () => Promise<PricingSettings | null>
}) {
	const queryClient = useQueryClient()
	const [baseline, setBaseline] = useState(settings)
	const [draft, setDraft] = useState<CrmPricingDraft>(() =>
		createCrmPricingDraft(settings)
	)
	const [pending, setPending] = useState<CrmPricingCommand | null>(null)
	const [conflict, setConflict] = useState(false)
	const [forbidden, setForbidden] = useState(false)
	const inFlight = useRef(false)
	const mutation = useMutation({
		mutationKey: [...queryKey, 'update'],
		mutationFn: adminCrmService.updatePricingSettings,
		retry: false,
		networkMode: 'always'
	})
	const values = parseCrmPricingDraft(draft)
	const dirty =
		values !== null &&
		ALL_FIELDS.some(key => values[key] !== baseline[key])
	const serverChanged = settings.version !== baseline.version
	const locked =
		!canEdit || !!pending || mutation.isPending || forbidden || conflict
	const canSave =
		canSubmit &&
		!mutation.isPending &&
		!forbidden &&
		!conflict &&
		(Boolean(pending) || (!serverChanged && dirty))

	const save = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!canSave || inFlight.current) return

		inFlight.current = true
		const toastId = toast.loading('Сохраняем тариф aeroCRM...')
		try {
			const command = createCrmPricingCommand(
				baseline,
				draft,
				pending?.commandId ?? window.crypto.randomUUID(),
				pending
			)
			setPending(command)
			const updated = await mutation.mutateAsync(command)
			setPending(null)
			setBaseline(updated)
			setDraft(createCrmPricingDraft(updated))
			queryClient.setQueryData<PricingSettings>(queryKey, current =>
				current && current.version > updated.version ? current : updated
			)
			toast.success('Новая версия тарифа aeroCRM сохранена', {
				id: toastId
			})
		} catch (error) {
			const status = axios.isAxiosError(error)
				? error.response?.status
				: null
			if (status === 409) {
				setConflict(true)
				toast.error(
					'Проверьте актуальную версию тарифа перед сохранением',
					{
						id: toastId
					}
				)
			} else if (status === 400) {
				setPending(null)
				toast.error(
					'Сервер отклонил настройки. Проверьте цены и число мест',
					{
						id: toastId
					}
				)
			} else if (status === 401 || status === 403) {
				setForbidden(true)
				void queryClient.invalidateQueries({ queryKey: ['get-profile'] })
				toast.error(
					'Сохранение недоступно. Требуется действующий доступ ADMIN или DEV',
					{
						id: toastId
					}
				)
			} else {
				toast.error(
					'Результат сохранения не подтверждён. Повторите ту же попытку',
					{ id: toastId }
				)
			}
		} finally {
			inFlight.current = false
		}
	}

	const loadLatestVersion = async () => {
		if (inFlight.current || (pending && !conflict) || forbidden) return
		const latest = await onReload()
		if (!latest) return
		setBaseline(latest)
		setPending(null)
		setConflict(false)
		toast('Черновик сохранён. Проверьте значения перед отправкой')
	}

	const resetDraft = () => {
		if (locked) return
		setBaseline(settings)
		setDraft(createCrmPricingDraft(settings))
		toast('Изменения тарифа отменены')
	}

	return (
		<div className={styles.pricingEditor}>
			<div className={styles.lockedHeading}>
				<div>
					<h4 className={styles.sectionTitle}>Изменить тариф</h4>
					<p className={styles.sectionHint}>
						Изменения создают новую версию. Условия уже начатого периода
						сохраняются.
					</p>
				</div>
				<AdminTooltip
					title="Изменение тарифа — для ADMIN и DEV"
					description="ADMIN и DEV могут опубликовать новую версию цен и лимитов. Изменение фиксируется в Журнале событий. Включено минимум два места с учётом владельца."
					risk="high"
					riskText="Проверьте отдельно полную сумму за год и цену дополнительного места. Тарифы виджетов на этом экране не изменяются."
				/>
			</div>

			{forbidden ? (
				<p className={styles.staleState} role="alert">
					Сервер не подтвердил право на изменение. Войдите с действующим
					доступом ADMIN или DEV и повторно откройте настройки.
				</p>
			) : conflict || (serverChanged && !pending) ? (
				<div className={styles.staleState} role="alert">
					<p>
						Текущая версия тарифа изменилась или команда конфликтует с
						предыдущей попыткой. Черновик сохранён. Загрузите последнюю
						версию и проверьте значения перед новым сохранением.
					</p>
					<button
						type="button"
						className={styles.refreshButton}
						onClick={() => void loadLatestVersion()}
						disabled={!canSubmit || mutation.isPending}
					>
						Проверить последнюю версию
					</button>
				</div>
			) : pending && !mutation.isPending ? (
				<p className={styles.staleState} role="alert">
					Результат сохранения не подтверждён. Нажмите «Повторить
					сохранение»: повтор использует те же значения и не создаст
					дублирующее изменение. До подтверждения поля заблокированы.
				</p>
			) : null}

			<form onSubmit={save}>
				<fieldset className={styles.pricingFields} disabled={locked}>
					<legend className={styles.srOnly}>Цены и места aeroCRM</legend>
					{ALL_FIELDS.map(field => {
						const isPrice = CRM_PRICE_FIELDS.some(price => price === field)
						return (
							<label className={styles.pricingField} key={field}>
								<span>{FIELD_LABELS[field]}</span>
								<input
									type={isPrice ? 'text' : 'number'}
									inputMode={isPrice ? 'decimal' : 'numeric'}
									min={isPrice ? undefined : field === 'includedSeats' ? 1 : 2}
									max={isPrice ? undefined : 10000}
									step={isPrice ? undefined : 1}
									maxLength={isPrice ? 16 : undefined}
									required
									readOnly={field === 'yearlyPriceMinor'}
									value={field === 'includedSeats' ? String(Number(draft.includedSeats) - 1) : draft[field]}
									onChange={event =>
										setDraft(current => {
											const value = event.target.value
											if (field === 'monthlyPriceMinor') {
												const minor = Number(value.replace(',', '.')) * 100
												return { ...current, monthlyPriceMinor: value, yearlyPriceMinor: Number.isFinite(minor) ? String(Math.round(minor * 108 / 10) / 100).replace('.', ',') : '' }
											}
											return { ...current, [field]: field === 'includedSeats' ? String(Number(value) + 1) : value }
										})
									}
								/>
							</label>
						)
					})}
				</fieldset>
				<p className={styles.sectionHint}>
					Цены: от 0,01 до 1 000 000 ₽, не более двух знаков после запятой.
					Места: целое число от 2 до 10 000. Годовая базовая цена вычисляется автоматически со скидкой 10%.
				</p>
				<div className={styles.pricingActions}>
					<button
						type="submit"
						className={styles.saveButton}
						disabled={!canSave}
					>
						{mutation.isPending
							? 'Сохраняем...'
							: pending && !conflict
								? 'Повторить сохранение'
								: 'Сохранить тариф'}
					</button>
					<button
						type="button"
						className={styles.refreshButton}
						onClick={resetDraft}
						disabled={locked}
					>
						Отменить изменения
					</button>
				</div>
			</form>
		</div>
	)
}
