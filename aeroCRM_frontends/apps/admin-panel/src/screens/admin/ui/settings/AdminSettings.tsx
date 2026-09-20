'use client'

import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import Heading from '@/shared/ui/heading/Heading'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import {
	adminTasksService,
	type ManualAdminTaskId,
	type ManualAdminTaskRunResult
} from '@/features/run-admin-task'
import { authSettingsService } from '@/features/auth/api/auth.api'
import { revalidateSiteSettings } from '@/entities/site-settings/actions'
import { siteSettingsService } from '@/entities/site-settings'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import { NextPage } from 'next'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AdminSettings.module.scss'

const MANUAL_TASKS: Array<{
	id: ManualAdminTaskId
	title: string
	description: string
	buttonLabel: string
}> = [
	{
		id: 'paymentCleanup',
		title: 'Очистка зависших платежей',
		description:
			'Запускает внеплановую очистку старых платежей со статусом ожидания.',
		buttonLabel: 'Запустить'
	},
	{
		id: 'subscriptionExpiryCheck',
		title: 'Проверка истёкших подписок',
		description:
			'Внепланово деактивирует подписки, срок действия которых уже истёк.',
		buttonLabel: 'Запустить'
	},
	{
		id: 'verificationChallengeCleanup',
		title: 'Очистка verification challenges',
		description:
			'Удаляет просроченные challenge-записи для подтверждения email и телефона.',
		buttonLabel: 'Запустить'
	}
]

const formatExecutedAt = (value: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'short',
		timeStyle: 'medium'
	}).format(new Date(value))

interface SettingsLoadErrorProps {
	description: string
	onRetry: () => void
	isRetrying: boolean
}

const SettingsLoadError = ({
	description,
	onRetry,
	isRetrying
}: SettingsLoadErrorProps) => (
	<>
		<p className={styles.fieldHint}>{description}</p>
		<button
			type="button"
			className={styles.taskBtn}
			onClick={onRetry}
			disabled={isRetrying}
		>
			{isRetrying ? 'Загружаем...' : 'Загрузить ещё раз'}
		</button>
	</>
)

const AdminSettings: NextPage = () => {
	const queryClient = useQueryClient()
	const router = useRouter()
	const [manualTaskResults, setManualTaskResults] = useState<
		Partial<Record<ManualAdminTaskId, ManualAdminTaskRunResult>>
	>({})

	const {
		data: settings,
		isLoading,
		isFetching,
		refetch: refetchSettings
	} = useQuery({
		queryKey: ['site-settings'],
		queryFn: siteSettingsService.get
	})
	const {
		data: authSettings,
		isLoading: isAuthSettingsLoading,
		isFetching: isAuthSettingsFetching,
		refetch: refetchAuthSettings
	} = useQuery({
		queryKey: ['auth-settings'],
		queryFn: authSettingsService.get
	})

	const [bannerText, setBannerText] = useState('')

	useEffect(() => {
		if (settings) setBannerText(settings.bannerText)
	}, [settings])

	const siteSettingsMutation = useMutation({
		mutationFn: siteSettingsService.update,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['site-settings'] })
			await revalidateSiteSettings()
			router.refresh()
		}
	})

	const saveSiteSettingsWithToast = (
		patch: Parameters<typeof siteSettingsService.update>[0]
	) => {
		const promise = siteSettingsMutation.mutateAsync(patch)
		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Сохранено',
			error: 'Ошибка сохранения'
		})
	}

	const authSettingsMutation = useMutation({
		mutationFn: authSettingsService.update,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['auth-settings'] })
		}
	})

	const saveAuthWithToast = (
		patch: Parameters<typeof authSettingsService.update>[0]
	) => {
		const promise = authSettingsMutation.mutateAsync(patch)
		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Сохранено',
			error: 'Ошибка сохранения'
		})
	}

	const manualTaskMutation = useMutation({
		mutationFn: adminTasksService.runTask,
		onSuccess: result => {
			setManualTaskResults(prev => ({
				...prev,
				[result.taskId]: result
			}))
		}
	})

	const activeManualTaskId = manualTaskMutation.isPending
		? manualTaskMutation.variables
		: null

	const runManualTaskWithToast = (taskId: ManualAdminTaskId) => {
		const task = MANUAL_TASKS.find(item => item.id === taskId)
		if (!task) return

		const promise = manualTaskMutation.mutateAsync(taskId)

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: result => result.message,
			error: 'Ошибка запуска задачи'
		})
	}

	const retrySettingsWithToast = () => {
		const promise = refetchSettings().then(result => {
			if (result.isError || !result.data) {
				throw result.error ?? new Error('Настройки не получены')
			}
			return result.data
		})

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Настройки загружены',
			error: 'Не удалось загрузить настройки'
		})
	}

	const retryAuthSettingsWithToast = () => {
		const promise = refetchAuthSettings().then(result => {
			if (result.isError || !result.data) {
				throw (
					result.error ?? new Error('Настройки авторизации не получены')
				)
			}
			return result.data
		})

		toast.promise(promise, {
			loading: 'Пожалуйста, подождите',
			success: 'Настройки авторизации загружены',
			error: 'Не удалось загрузить настройки авторизации'
		})
	}

	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />

			<AdminSectionHeading
				title="Авторизация и защита"
				description="Здесь включаются и выключаются Turnstile и социальный вход через Google, Яндекс или VK."
				risk="high"
				riskText="Отключение Turnstile снижает защиту форм от спама. Отключение соцвхода может закрыть пользователям привычный способ входа."
				text="Авторизация и защита"
			/>

			<div className={styles.section}>
				{isAuthSettingsLoading ? (
					<>
						{Array.from({ length: 4 }).map((_, index) => (
							<div key={index} className={styles.toggleRow}>
								<div style={{ flex: 1 }}>
									<SkeletonLoader
										count={1}
										className="h-[18px] w-48 mb-2"
									/>
									<SkeletonLoader count={1} className="h-[14px] w-72" />
								</div>
								<SkeletonLoader count={1} className="h-[28px] w-[52px]" />
							</div>
						))}
					</>
				) : authSettings ? (
					<>
						<div className={styles.toggleRow}>
							<div>
								<p className={styles.fieldLabel}>Проверка Turnstile</p>
								<p className={styles.fieldHint}>
									Если выключено, формы входа, регистрации и восстановления
									пароля не требуют проверку Turnstile
								</p>
							</div>
							<button
								className={`${styles.toggle} ${authSettings.turnstileEnabled ? styles.toggleOn : ''}`}
								onClick={() =>
									saveAuthWithToast({
										turnstileEnabled: !authSettings.turnstileEnabled
									})
								}
								disabled={authSettingsMutation.isPending}
							>
								<span className={styles.toggleThumb} />
							</button>
						</div>

						<div className={styles.toggleRow}>
							<div>
								<p className={styles.fieldLabel}>Вход через Google</p>
								<p className={styles.fieldHint}>
									Если выключено, кнопка Google скрывается, а прямой
									переход на Google-авторизацию блокируется
								</p>
							</div>
							<button
								className={`${styles.toggle} ${authSettings.googleAuthEnabled ? styles.toggleOn : ''}`}
								onClick={() =>
									saveAuthWithToast({
										googleAuthEnabled: !authSettings.googleAuthEnabled
									})
								}
								disabled={authSettingsMutation.isPending}
							>
								<span className={styles.toggleThumb} />
							</button>
						</div>

						<div className={styles.toggleRow}>
							<div>
								<p className={styles.fieldLabel}>Вход через Яндекс</p>
								<p className={styles.fieldHint}>
									Если выключено, кнопка Яндекс скрывается, а прямой
									переход на Яндекс-авторизацию блокируется
								</p>
							</div>
							<button
								className={`${styles.toggle} ${authSettings.yandexAuthEnabled ? styles.toggleOn : ''}`}
								onClick={() =>
									saveAuthWithToast({
										yandexAuthEnabled: !authSettings.yandexAuthEnabled
									})
								}
								disabled={authSettingsMutation.isPending}
							>
								<span className={styles.toggleThumb} />
							</button>
						</div>

						<div className={styles.toggleRow}>
							<div>
								<p className={styles.fieldLabel}>Вход через VK</p>
								<p className={styles.fieldHint}>
									Если выключено, кнопка VK скрывается, а прямой переход на
									VK-авторизацию блокируется
								</p>
							</div>
							<button
								className={`${styles.toggle} ${authSettings.vkAuthEnabled ? styles.toggleOn : ''}`}
								onClick={() =>
									saveAuthWithToast({
										vkAuthEnabled: !authSettings.vkAuthEnabled
									})
								}
								disabled={authSettingsMutation.isPending}
							>
								<span className={styles.toggleThumb} />
							</button>
						</div>
					</>
				) : (
					<SettingsLoadError
						description="Identity Service не вернул настройки авторизации. Тумблеры заблокированы до успешной загрузки."
						onRetry={retryAuthSettingsWithToast}
						isRetrying={isAuthSettingsFetching}
					/>
				)}
			</div>

			<AdminSectionHeading
				title="Баннер на сайте"
				description="Показывает общее сообщение на страницах сайта: например, предупреждение о работах или важное объявление."
				risk="medium"
				riskText="Неверный текст увидят все пользователи. Перед сохранением проверь смысл, даты и контакты."
				text="Баннер на сайте"
			/>

			<div className={styles.section}>
				{isLoading ? (
					<>
						<div className={styles.toggleRow}>
							<div style={{ flex: 1 }}>
								<SkeletonLoader count={1} className="h-[18px] w-48 mb-2" />
								<SkeletonLoader count={1} className="h-[14px] w-72" />
							</div>
							<SkeletonLoader count={1} className="h-[28px] w-[52px]" />
						</div>
						<SkeletonLoader count={1} className="h-[80px]" />
						<SkeletonLoader count={1} className="h-[38px] w-36" />
					</>
				) : settings ? (
					<>
						<div className={styles.toggleRow}>
							<div>
								<p className={styles.fieldLabel}>Показывать баннер</p>
								<p className={styles.fieldHint}>
									Баннер отображается на всех страницах сайта
								</p>
							</div>
							<button
								className={`${styles.toggle} ${settings?.bannerEnabled ? styles.toggleOn : ''}`}
								onClick={() =>
									saveSiteSettingsWithToast({
										bannerEnabled: !settings?.bannerEnabled
									})
								}
								disabled={siteSettingsMutation.isPending}
							>
								<span className={styles.toggleThumb} />
							</button>
						</div>

						<div className={styles.field}>
							<label htmlFor="banner-text" className={styles.fieldLabel}>
								Текст баннера
							</label>
							<textarea
								id="banner-text"
								className={styles.textarea}
								placeholder="Например: Технические работы с 22:00 до 00:00. Сервис может быть недоступен."
								value={bannerText}
								onChange={e => setBannerText(e.target.value)}
								rows={3}
								maxLength={300}
								aria-describedby="banner-text-count"
							/>
							<span id="banner-text-count" className={styles.charCount}>
								{bannerText.length} / 300
							</span>
						</div>

						<button
							className={styles.saveBtn}
							onClick={() => saveSiteSettingsWithToast({ bannerText })}
							disabled={
								siteSettingsMutation.isPending ||
								bannerText === settings?.bannerText
							}
						>
							Сохранить текст
						</button>
					</>
				) : (
					<SettingsLoadError
						description="Настройки баннера недоступны. До успешной загрузки изменения заблокированы."
						onRetry={retrySettingsWithToast}
						isRetrying={isFetching}
					/>
				)}
			</div>

			<AdminSectionHeading
				title="Ручной запуск задач"
				description="Позволяет вне расписания запустить системные задачи обслуживания: очистку платежей, проверку подписок и удаление устаревших challenge-записей."
				risk="high"
				riskText="Запускай только когда понимаешь цель задачи: действие влияет на реальные платежи, подписки или записи подтверждения."
				text="Ручной запуск задач"
			/>

			<div className={styles.section}>
				<div className={styles.taskList}>
					{MANUAL_TASKS.map(task => {
						const result = manualTaskResults[task.id]
						const isRunning =
							manualTaskMutation.isPending &&
							activeManualTaskId === task.id

						return (
							<div key={task.id} className={styles.taskRow}>
								<div className={styles.taskMeta}>
									<p className={styles.fieldLabel}>{task.title}</p>
									<p className={styles.fieldHint}>{task.description}</p>
									{result && (
										<p className={styles.taskResult}>
											{result.message}
											<span className={styles.taskTimestamp}>
												Последний запуск:{' '}
												{formatExecutedAt(result.executedAt)}
											</span>
										</p>
									)}
								</div>

								<button
									type="button"
									className={styles.taskBtn}
									onClick={() => runManualTaskWithToast(task.id)}
									disabled={manualTaskMutation.isPending}
								>
									{isRunning ? 'Запуск...' : task.buttonLabel}
								</button>
							</div>
						)
					})}
				</div>
			</div>

			<AdminSectionHeading
				title="Новогодний режим"
				description="Включает декоративные снежинки на страницах сайта для сезонного оформления."
				risk="low"
				riskText="На данные и оплату не влияет. Возможный риск только визуальный: эффект может быть неуместен вне сезона."
				text="Новогодний режим"
			/>

			<div className={styles.section}>
				{isLoading ? (
					<div className={styles.toggleRow}>
						<div style={{ flex: 1 }}>
							<SkeletonLoader count={1} className="h-[18px] w-48 mb-2" />
							<SkeletonLoader count={1} className="h-[14px] w-72" />
						</div>
						<SkeletonLoader count={1} className="h-[28px] w-[52px]" />
					</div>
				) : settings ? (
					<div className={styles.toggleRow}>
						<div>
							<p className={styles.fieldLabel}>Снежинки на сайте</p>
							<p className={styles.fieldHint}>
								Летящие снежинки отображаются на всех страницах сайта
							</p>
						</div>
						<button
							className={`${styles.toggle} ${settings?.snowflakeEnabled ? styles.toggleOn : ''}`}
							onClick={() =>
								saveSiteSettingsWithToast({
									snowflakeEnabled: !settings?.snowflakeEnabled
								})
							}
							disabled={siteSettingsMutation.isPending}
						>
							<span className={styles.toggleThumb} />
						</button>
					</div>
				) : (
					<SettingsLoadError
						description="Настройки оформления недоступны. До успешной загрузки изменения заблокированы."
						onRetry={retrySettingsWithToast}
						isRetrying={isFetching}
					/>
				)}
			</div>
		</section>
	)
}

export default AdminSettings
