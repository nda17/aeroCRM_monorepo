'use client'
import { IUserEditInput } from '@/entities/user'
import styles from '@/screens/admin/ui/user/edit/UserEdit.module.scss'
import {
	AdminAutoRenewalAction,
	AdminAutoRenewalActionInput,
	useUserEdit
} from '@/screens/admin/model/user/useUserEdit'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import ConfirmDialog from '@/shared/ui/confirm-dialog/ConfirmDialog'
import FieldEmail from '@/shared/ui/form-elements/admin-page/field-email/FieldEmail'
import FieldId from '@/shared/ui/form-elements/admin-page/field-id/FieldId'
import FieldName from '@/shared/ui/form-elements/admin-page/field-name/FieldName'
import FieldPassword from '@/shared/ui/form-elements/admin-page/field-password/FieldPassword'
import FieldPhone from '@/shared/ui/form-elements/admin-page/field-phone/FieldPhone'
import { FieldUploadFile } from '@/features/upload-file'
import Heading from '@/shared/ui/heading/Heading'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { UserInfo } from '@/entities/user'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import { useUser } from '@/entities/user'
import { UserRole } from '@/entities/user'
import type {
	AdminAutoRenewalStatus,
	IAdminAutoRenewalDetail,
	IAdminAutoRenewalMaskedMethod,
	IAdminUserOverview
} from '@/entities/user'
import { UserLoginMethod } from '@/entities/user'
import {
	validName,
	validEmail,
	validPassword,
	validPhone
} from '@/shared/regex'
import { IParamsUrl } from '@/shared/types/params-url.types'
import clsx from 'clsx'
import { NextPage } from 'next'
import Link from '@/shared/lib/navigation/ZoneLink'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

const FIELD_STYLE = { marginBottom: 0 }

type UserEditForm = IUserEditInput & { avatarPreview?: string | null }

const PLAN_LABELS: Record<string, string> = {
	TRIAL: 'Trial',
	EASY: 'Easy',
	HARD: 'Hard'
}

const PERIOD_LABELS: Record<string, string> = {
	MONTHLY: 'Месяц',
	YEARLY: 'Год'
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
	ACTIVE: 'Активна',
	EXPIRED: 'Истекла',
	CANCELLED: 'Отменена'
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
	PENDING: 'Ожидает',
	SUCCEEDED: 'Оплачен',
	CANCELLED: 'Отменён',
	EXPIRED: 'Срок истёк'
}

const AUTO_RENEWAL_STATUS_LABELS: Record<AdminAutoRenewalStatus, string> =
	{
		NEVER_CONSENTED: 'Согласие не давалось',
		ACTIVE: 'Активно',
		USER_DISABLED: 'Отключено пользователем',
		ADMIN_PAUSED: 'Приостановлено администратором',
		TECHNICAL_PAUSE: 'Техническая пауза',
		REVOKED: 'Согласие отозвано'
	}

const AUTO_RENEWAL_STATUS_DESCRIPTIONS: Record<
	AdminAutoRenewalStatus,
	string
> = {
	NEVER_CONSENTED:
		'Автопродление нельзя включить из панели администратора. Пользователь должен сам дать явное согласие в платёжном сценарии.',
	ACTIVE:
		'Автосписания разрешены пользователем и могут выполняться по расписанию.',
	USER_DISABLED:
		'Пользователь отключил автосписания в личном кабинете. Администратор не может включить их обратно.',
	ADMIN_PAUSED:
		'Автопродление поставлено на административную паузу. Возобновление возможно только при действующем согласии и сохранённом способе оплаты.',
	TECHNICAL_PAUSE:
		'Автосписания остановлены системой. Сверка и снятие технической паузы доступны только роли DEV.',
	REVOKED:
		'Отзыв согласия зафиксирован. Повторное включение возможно только после нового явного согласия пользователя.'
}

interface AutoRenewalDialogConfig {
	title: string
	message: string
	confirmLabel: string
	reasonLabel?: string
	reasonPlaceholder?: string
}

const AUTO_RENEWAL_DIALOGS: Record<
	AdminAutoRenewalAction,
	AutoRenewalDialogConfig
> = {
	pause: {
		title: 'Приостановить автопродление?',
		message:
			'Новые автоматические списания будут остановлены. Согласие пользователя и сохранённый способ оплаты останутся без изменений.',
		confirmLabel: 'Приостановить',
		reasonLabel: 'Причина административной паузы',
		reasonPlaceholder: 'Например: проверка обращения пользователя'
	},
	resume: {
		title: 'Возобновить автопродление?',
		message:
			'Действие снимает только административную паузу. Backend дополнительно проверит действующее согласие пользователя и сохранённый способ оплаты.',
		confirmLabel: 'Возобновить',
		reasonLabel: 'Причина возобновления',
		reasonPlaceholder: 'Например: обращение обработано'
	},
	revoke: {
		title: 'Зафиксировать отзыв согласия?',
		message:
			'Используйте действие только по прямому запросу пользователя. Автосписания будут запрещены, а включить их обратно из панели администратора будет нельзя.',
		confirmLabel: 'Зафиксировать отзыв',
		reasonLabel: 'Основание отзыва',
		reasonPlaceholder: 'Например: обращение пользователя №123'
	},
	reconcile: {
		title: 'Сверить состояние автопродления?',
		message:
			'DEV-сверка проверит техническое состояние и сохранённый способ оплаты. Она не создаёт согласие пользователя и не включает отозванное или отключённое автопродление.',
		confirmLabel: 'Запустить сверку'
	},
	resumeTechnical: {
		title: 'Снять техническую паузу?',
		message:
			'Backend разрешит действие только при действующем согласии, сохранённом способе оплаты и доступном пользователе.',
		confirmLabel: 'Снять паузу',
		reasonLabel: 'Причина снятия технической паузы',
		reasonPlaceholder: 'Например: проблема платёжного метода устранена'
	}
}

const EVENT_SECTION_LABELS: Record<string, string> = {
	PAYMENTS: 'Платежи',
	CAMPAIGNS: 'Кампании',
	TASKS: 'Задачи',
	SUBSCRIPTIONS: 'Подписки',
	USERS: 'Пользователи',
	MESSAGING: 'Очереди'
}

const EVENT_ACTION_LABELS: Record<string, string> = {
	PAYMENT_MANUAL_CHECK: 'Проверка платежа',
	PAYMENT_CLEANUP_RUN: 'Очистка платежей',
	AUTO_RENEWAL_ADMIN_PAUSE: 'Пауза автопродления',
	AUTO_RENEWAL_ADMIN_RESUME: 'Возобновление автопродления',
	AUTO_RENEWAL_REVOKE: 'Отзыв согласия на автопродление',
	AUTO_RENEWAL_RECONCILE: 'Сверка автопродления',
	AUTO_RENEWAL_TECHNICAL_RESUME: 'Снятие технической паузы',
	CAMPAIGN_CREATE: 'Создание кампании',
	CAMPAIGN_CANCEL: 'Остановка кампании',
	CAMPAIGN_DELIVERY_RETRY: 'Повтор доставки кампании',
	SUBSCRIPTION_ACTIVATE: 'Активация подписки',
	SUBSCRIPTION_EXTEND_DAYS: 'Бонусные дни',
	SUBSCRIPTION_CANCEL: 'Отмена подписки',
	SUBSCRIPTION_EXPIRY_CHECK_RUN: 'Проверка сроков',
	VERIFICATION_CHALLENGE_CLEANUP_RUN: 'Очистка кодов',
	USER_UPDATE: 'Редактирование',
	USER_TOGGLE_ACTIVATION: 'Статус аккаунта',
	USER_DELETE: 'Удаление',
	USER_SOFT_DELETE: 'Soft delete',
	USER_RESTORE: 'Восстановление',
	MESSAGING_FAILURE_RETRY: 'Повтор интеграции'
}

const formatOptionalPattern = (
	value: string | undefined,
	pattern: RegExp,
	message: string
) => !value || pattern.test(value) || message

const formatCreatedAt = (value: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'medium'
	}).format(new Date(value))

const formatDateTime = (value: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(value))

const formatAmount = (value: string) => {
	const amount = Number(value)

	if (Number.isNaN(amount)) {
		return `${value} ₽`
	}

	return new Intl.NumberFormat('ru-RU', {
		style: 'currency',
		currency: 'RUB'
	}).format(amount)
}

const getLabel = (
	labels: Record<string, string>,
	value?: string | null
) => (value ? (labels[value] ?? value) : 'Нет данных')

const formatAutoRenewalAmount = (
	amount: string | null,
	currency: string | null
) => {
	if (!amount) return 'Нет данных'

	const numericAmount = Number(amount)
	if (Number.isNaN(numericAmount)) {
		return `${amount}${currency ? ` ${currency}` : ''}`
	}

	try {
		return new Intl.NumberFormat('ru-RU', {
			style: 'currency',
			currency: currency || 'RUB'
		}).format(numericAmount)
	} catch {
		return `${amount}${currency ? ` ${currency}` : ''}`
	}
}

const formatMaskedMethod = (
	method: IAdminAutoRenewalMaskedMethod | null
) => {
	if (!method) return 'Не сохранён'

	const methodTitle = method.title || method.type || 'Способ оплаты'
	return method.last4
		? `${methodTitle} · •••• ${method.last4}`
		: methodTitle
}

const getAutoRenewalStatusClass = (status: AdminAutoRenewalStatus) => {
	switch (status) {
		case 'ACTIVE':
			return styles.renewalStatusSuccess
		case 'ADMIN_PAUSED':
		case 'TECHNICAL_PAUSE':
			return styles.renewalStatusWarning
		case 'USER_DISABLED':
		case 'REVOKED':
			return styles.renewalStatusDanger
		case 'NEVER_CONSENTED':
			return styles.renewalStatusMuted
	}
}

const getAutoRenewalPendingLabel = (
	action: AdminAutoRenewalAction,
	fallback: string,
	pendingAction?: AdminAutoRenewalAction
) => (pendingAction === action ? 'Выполняется...' : fallback)

interface AutoRenewalSectionProps {
	autoRenewal?: IAdminAutoRenewalDetail
	isLoading: boolean
	isError: boolean
	isDev: boolean
	isUpdating: boolean
	pendingAction?: AdminAutoRenewalAction
	onAction: (action: AdminAutoRenewalAction) => void
}

const AutoRenewalSection = ({
	autoRenewal,
	isLoading,
	isError,
	isDev,
	isUpdating,
	pendingAction,
	onAction
}: AutoRenewalSectionProps) => {
	const renderContent = () => {
		if (isLoading) {
			return (
				<div className={styles.renewalLoading}>
					<SkeletonLoader
						count={1}
						className={styles.loadingRenewalStatus}
					/>
					<SkeletonLoader
						count={1}
						className={styles.loadingRenewalDetails}
					/>
					<SkeletonLoader
						count={1}
						className={styles.loadingRenewalActions}
					/>
				</div>
			)
		}

		if (isError || !autoRenewal) {
			return (
				<div className={styles.renewalError}>
					<p className={styles.renewalErrorTitle}>
						Статус автопродления недоступен
					</p>
					<p className={styles.renewalErrorText}>
						Не удалось получить безопасное состояние автосписаний. Обновите
						страницу перед любыми действиями.
					</p>
				</div>
			)
		}

		const { status, capabilities, validity, maskedMethod, priceChange } =
			autoRenewal

		return (
			<div className={styles.renewalPanel}>
				<div className={styles.renewalHeader}>
					<div>
						<p className={styles.renewalLabel}>Текущий статус</p>
						<span
							className={clsx(
								styles.renewalStatus,
								getAutoRenewalStatusClass(status)
							)}
						>
							{AUTO_RENEWAL_STATUS_LABELS[status]}
						</span>
					</div>
					<p className={styles.renewalStatusDescription}>
						{AUTO_RENEWAL_STATUS_DESCRIPTIONS[status]}
					</p>
				</div>

				<div className={styles.renewalDetailsGrid}>
					<div className={styles.renewalDetail}>
						<span className={styles.renewalDetailLabel}>Тариф</span>
						<span className={styles.renewalDetailValue}>
							{getLabel(PLAN_LABELS, autoRenewal.plan)}
							{autoRenewal.billingPeriod
								? ` · ${getLabel(
										PERIOD_LABELS,
										autoRenewal.billingPeriod
									)}`
								: ''}
						</span>
					</div>
					<div className={styles.renewalDetail}>
						<span className={styles.renewalDetailLabel}>Сумма</span>
						<span className={styles.renewalDetailValue}>
							{formatAutoRenewalAmount(
								autoRenewal.amount,
								autoRenewal.currency
							)}
						</span>
					</div>
					<div className={styles.renewalDetail}>
						<span className={styles.renewalDetailLabel}>
							Следующее списание
						</span>
						<span className={styles.renewalDetailValue}>
							{autoRenewal.nextChargeAt
								? formatDateTime(autoRenewal.nextChargeAt)
								: 'Не запланировано'}
						</span>
					</div>
					<div className={styles.renewalDetail}>
						<span className={styles.renewalDetailLabel}>Согласие</span>
						<span className={styles.renewalDetailValue}>
							{autoRenewal.consentedAt
								? formatDateTime(autoRenewal.consentedAt)
								: 'Не зафиксировано'}
							{autoRenewal.consentVersion
								? ` · ${autoRenewal.consentVersion}`
								: ''}
						</span>
					</div>
					<div
						className={clsx(
							styles.renewalDetail,
							styles.renewalDetailWide
						)}
					>
						<span className={styles.renewalDetailLabel}>
							Сохранённый способ оплаты
						</span>
						<span className={styles.renewalDetailValue}>
							{formatMaskedMethod(maskedMethod)}
						</span>
						{maskedMethod?.savedAt && (
							<span className={styles.renewalDetailMeta}>
								Сохранён {formatDateTime(maskedMethod.savedAt)}
							</span>
						)}
					</div>
				</div>

				<div className={styles.renewalValidity}>
					<span
						className={clsx(
							styles.renewalValidityBadge,
							validity.hasConsent
								? styles.renewalValiditySuccess
								: styles.renewalValidityDanger
						)}
					>
						Согласие зафиксировано: {validity.hasConsent ? 'да' : 'нет'}
					</span>
					<span
						className={clsx(
							styles.renewalValidityBadge,
							validity.hasPaymentMethod
								? styles.renewalValiditySuccess
								: styles.renewalValidityDanger
						)}
					>
						Способ оплаты:{' '}
						{validity.hasPaymentMethod ? 'сохранён' : 'отсутствует'}
					</span>
					<span
						className={clsx(
							styles.renewalValidityBadge,
							validity.userEligible
								? styles.renewalValiditySuccess
								: styles.renewalValidityDanger
						)}
					>
						Аккаунт: {validity.userEligible ? 'доступен' : 'недоступен'}
					</span>
				</div>

				<div
					className={clsx(
						styles.renewalPriceChange,
						priceChange.required
							? styles.renewalPriceChangeRequired
							: styles.renewalPriceChangeClear
					)}
				>
					<div>
						<p className={styles.renewalPriceChangeTitle}>
							Изменение цены:{' '}
							{priceChange.required
								? 'требуется подтверждение'
								: 'подтверждение не требуется'}
						</p>
						<p className={styles.renewalPriceChangeText}>
							{priceChange.previousAmount
								? formatAutoRenewalAmount(
										priceChange.previousAmount,
										priceChange.currency
									)
								: 'Предыдущая цена не зафиксирована'}
							{' → '}
							{priceChange.newAmount
								? formatAutoRenewalAmount(
										priceChange.newAmount,
										priceChange.currency
									)
								: 'Новая цена не определена'}
						</p>
						{priceChange.detectedAt && (
							<p className={styles.renewalPriceChangeMeta}>
								Изменение обнаружено{' '}
								{formatDateTime(priceChange.detectedAt)}
							</p>
						)}
					</div>
					{priceChange.required && (
						<p className={styles.renewalPriceChangeNotice}>
							Подтвердить новую цену может только пользователь в личном
							кабинете
							{priceChange.canConfirm
								? '. До подтверждения возобновление заблокировано.'
								: '. Сейчас подтверждение пользователю недоступно; возобновление заблокировано.'}
						</p>
					)}
				</div>

				{(autoRenewal.disabledAt ||
					autoRenewal.disableReason ||
					autoRenewal.lastChargeAttemptAt ||
					autoRenewal.lastChargeErrorCode) && (
					<div className={styles.renewalDiagnostics}>
						{autoRenewal.disabledAt && (
							<p>Отключено: {formatDateTime(autoRenewal.disabledAt)}</p>
						)}
						{autoRenewal.disableReason && (
							<p>Причина: {autoRenewal.disableReason}</p>
						)}
						{autoRenewal.lastChargeAttemptAt && (
							<p>
								Последняя попытка:{' '}
								{formatDateTime(autoRenewal.lastChargeAttemptAt)}
							</p>
						)}
						{autoRenewal.lastChargeErrorCode && (
							<p>Код ошибки: {autoRenewal.lastChargeErrorCode}</p>
						)}
					</div>
				)}

				<div className={styles.renewalActions}>
					<button
						type="button"
						className={styles.renewalSecondaryButton}
						disabled={isUpdating || !capabilities.canPause}
						onClick={() => onAction('pause')}
					>
						{getAutoRenewalPendingLabel(
							'pause',
							'Приостановить',
							pendingAction
						)}
					</button>
					<button
						type="button"
						className={styles.renewalPrimaryButton}
						disabled={
							isUpdating ||
							priceChange.required ||
							!capabilities.canResumeAdminPause
						}
						onClick={() => onAction('resume')}
					>
						{getAutoRenewalPendingLabel(
							'resume',
							'Снять админ-паузу',
							pendingAction
						)}
					</button>
					<button
						type="button"
						className={styles.renewalDangerButton}
						disabled={isUpdating || !capabilities.canRevoke}
						onClick={() => onAction('revoke')}
					>
						{getAutoRenewalPendingLabel(
							'revoke',
							'Зафиксировать отзыв',
							pendingAction
						)}
					</button>
				</div>

				<div
					className={clsx(
						styles.renewalTechnicalPanel,
						!isDev && styles.renewalTechnicalPanelLocked
					)}
				>
					<div
						className={clsx(
							styles.renewalTechnicalContent,
							!isDev && styles.renewalTechnicalContentBlurred
						)}
					>
						<div>
							<p className={styles.renewalTechnicalTitle}>
								Техническое восстановление
							</p>
							<p className={styles.renewalTechnicalText}>
								Сверка состояния и снятие только технической паузы. Эти
								действия не создают согласие пользователя.
							</p>
						</div>
						<div className={styles.renewalTechnicalActions}>
							<button
								type="button"
								className={styles.renewalSecondaryButton}
								disabled={
									!isDev || isUpdating || !capabilities.canReconcile
								}
								onClick={() => onAction('reconcile')}
							>
								{getAutoRenewalPendingLabel(
									'reconcile',
									'Сверить',
									pendingAction
								)}
							</button>
							<button
								type="button"
								className={styles.renewalPrimaryButton}
								disabled={
									!isDev ||
									isUpdating ||
									priceChange.required ||
									!capabilities.canResumeTechnical
								}
								onClick={() => onAction('resumeTechnical')}
							>
								{getAutoRenewalPendingLabel(
									'resumeTechnical',
									'Снять тех. паузу',
									pendingAction
								)}
							</button>
						</div>
					</div>

					{!isDev && (
						<div className={styles.renewalTechnicalOverlay}>
							<span className={styles.renewalTechnicalBadge}>
								Технические действия доступны только DEV
							</span>
							<AdminTooltip
								title="DEV-only блок"
								description="ADMIN видит техническое состояние, но сверка и снятие технической паузы защищены отдельными DEV-endpoint на backend."
								risk="high"
								riskText="Эти операции могут изменить состояние автоматических списаний и требуют технической проверки."
							/>
						</div>
					)}
				</div>
			</div>
		)
	}

	return (
		<div className={styles.formSection}>
			<div>
				<div className={styles.titleWithHelp}>
					<p className={styles.sectionTitle}>Автопродление</p>
					<AdminTooltip
						title="Управление автопродлением"
						description="ADMIN и DEV могут приостановить автосписания, снять только административную паузу и зафиксировать отзыв по запросу пользователя."
						risk="high"
						riskText="Нельзя включать автопродление без явного согласия пользователя или после его отзыва. Backend повторно проверяет допустимость каждого перехода."
					/>
				</div>
				<p className={styles.sectionHint}>
					Статус загружается отдельно от формы профиля. Действия
					применяются сразу и не требуют кнопки «Сохранить изменения».
				</p>
			</div>
			{renderContent()}
		</div>
	)
}

const UserOverview360 = ({
	overview,
	isLoading,
	userId
}: {
	overview?: IAdminUserOverview
	isLoading: boolean
	userId: string
}) => {
	if (isLoading) {
		return (
			<div className={styles.overview}>
				<div className={styles.overviewHeader}>
					<SkeletonLoader
						count={1}
						className={styles.loadingSectionTitle}
					/>
					<SkeletonLoader
						count={1}
						className={styles.loadingSectionHint}
					/>
				</div>
				<div className={styles.overviewLoadingGrid}>
					<SkeletonLoader count={1} className={styles.loadingInfoCard} />
					<SkeletonLoader count={1} className={styles.loadingInfoCard} />
					<SkeletonLoader count={1} className={styles.loadingInfoCard} />
				</div>
			</div>
		)
	}

	if (!overview) {
		return (
			<div className={styles.overview}>
				<p className={styles.overviewTitle}>Карточка 360</p>
				<p className={styles.overviewEmpty}>
					Сводка по пользователю сейчас недоступна.
				</p>
			</div>
		)
	}

	const subscription = overview.subscription
	const latestPayment = overview.payments.latest[0]

	return (
		<div className={styles.overview}>
			<div className={styles.overviewHeader}>
				<p className={styles.overviewTitle}>Карточка 360</p>
				<p className={styles.overviewSubtitle}>
					Сводка по подписке, платежам и действиям.
				</p>
			</div>

			<div className={styles.overviewSection}>
				<p className={styles.overviewSectionTitle}>Подписка</p>
				<div className={styles.overviewMetricGrid}>
					<div>
						<span className={styles.overviewMetricLabel}>Тариф</span>
						<span className={styles.overviewMetricValue}>
							{subscription
								? getLabel(PLAN_LABELS, subscription.plan)
								: 'Нет подписки'}
						</span>
					</div>
					<div>
						<span className={styles.overviewMetricLabel}>Статус</span>
						<span className={styles.overviewMetricValue}>
							{subscription
								? getLabel(SUBSCRIPTION_STATUS_LABELS, subscription.status)
								: 'Нет данных'}
						</span>
					</div>
					<div>
						<span className={styles.overviewMetricLabel}>Период</span>
						<span className={styles.overviewMetricValue}>
							{subscription
								? getLabel(PERIOD_LABELS, subscription.billingPeriod)
								: 'Нет данных'}
						</span>
					</div>
				</div>
				<p className={styles.overviewNote}>
					Окончание:{' '}
					{subscription?.expiresAt
						? formatDateTime(subscription.expiresAt)
						: 'без даты'}
				</p>
			</div>

			<div className={styles.overviewSection}>
				<p className={styles.overviewSectionTitle}>Платежи</p>
				<div className={styles.overviewPills}>
					<span className={styles.overviewPill}>
						Всего {overview.payments.total}
					</span>
					<span className={styles.overviewPill}>
						Ожидает {overview.payments.counts.PENDING}
					</span>
					<span className={styles.overviewPill}>
						Оплачено {overview.payments.counts.SUCCEEDED}
					</span>
					<span className={styles.overviewPill}>
						Отменено {overview.payments.counts.CANCELLED}
					</span>
					<span className={styles.overviewPill}>
						Истекло {overview.payments.counts.EXPIRED}
					</span>
				</div>
				{latestPayment ? (
					<div className={styles.overviewList}>
						<div className={styles.overviewListItem}>
							<div>
								<p className={styles.overviewListTitle}>
									{formatAmount(latestPayment.amount)}
								</p>
								<p className={styles.overviewListMeta}>
									{getLabel(PAYMENT_STATUS_LABELS, latestPayment.status)}
									{' · '}
									{formatDateTime(latestPayment.createdAt)}
								</p>
							</div>
						</div>
					</div>
				) : (
					<p className={styles.overviewEmpty}>Платежей пока нет.</p>
				)}
			</div>

			<div className={styles.overviewSection}>
				<div className={styles.overviewSectionHeader}>
					<p className={styles.overviewSectionTitle}>Последние действия</p>
					<Link
						href={`${ADMIN_PAGES.EVENT_LOG}?userId=${encodeURIComponent(userId)}`}
						className={styles.overviewSectionLink}
					>
						Все действия
					</Link>
				</div>
				{overview.activity.latest.length ? (
					<div className={styles.overviewList}>
						{overview.activity.latest.map(item => (
							<div key={item.id} className={styles.overviewListItem}>
								<div>
									<p className={styles.overviewListTitle}>
										{getLabel(EVENT_ACTION_LABELS, item.action)}
									</p>
									<p className={styles.overviewListMeta}>
										{getLabel(EVENT_SECTION_LABELS, item.section)} ·{' '}
										{formatDateTime(item.createdAt)}
									</p>
									<p className={styles.overviewListMeta}>
										{item.description}
									</p>
								</div>
							</div>
						))}
					</div>
				) : (
					<p className={styles.overviewEmpty}>
						Действий по пользователю пока нет.
					</p>
				)}
			</div>
		</div>
	)
}

const UserEdit: NextPage<IParamsUrl> = ({ params }) => {
	const [isActivationConfirmOpen, setIsActivationConfirmOpen] =
		useState(false)
	const [autoRenewalDialogAction, setAutoRenewalDialogAction] =
		useState<AdminAutoRenewalAction | null>(null)
	const [autoRenewalReason, setAutoRenewalReason] = useState('')
	const { user: currentUser } = useUser()
	const {
		handleSubmit,
		register,
		formState: { errors },
		reset,
		control,
		watch
	} = useForm<UserEditForm>({ mode: 'onChange' })

	const {
		isLoading,
		data,
		overview,
		isOverviewLoading,
		autoRenewal,
		isAutoRenewalLoading,
		isAutoRenewalError,
		isAutoRenewalUpdating,
		autoRenewalUpdatingAction,
		manageAutoRenewal,
		onSubmit,
		isSaving,
		isActivationUpdating,
		toggleActivation,
		uploadAvatar,
		deleteAvatar
	} = useUserEdit(params)

	const loginMethodLabels: Record<UserLoginMethod, string> = {
		EMAIL: 'Email',
		PHONE: 'Телефон',
		GOOGLE: 'Google',
		GITHUB: 'GitHub',
		YANDEX: 'Яндекс',
		VK: 'VK',
		TELEGRAM: 'Telegram'
	}

	useEffect(() => {
		if (!data) return

		reset(
			{
				avatarPreview: '',
				email: data.email ?? '',
				isAdmin: data.rights.includes(UserRole.ADMIN),
				isDev: data.rights.includes(UserRole.DEV),
				isPhoneVerified: Boolean(data.isPhoneVerified),
				name: data.name ?? '',
				password: '',
				phone: data.phone ?? ''
			},
			{
				keepDirtyValues: true,
				keepErrors: true,
				keepTouched: true
			}
		)
	}, [data, reset])

	const loginMethods =
		data?.loginMethods?.map(
			method => loginMethodLabels[method] ?? method
		) ?? []
	const isDeactivated = data?.status === 'DEACTIVATED'
	const activationActionLabel = isDeactivated
		? 'Активировать пользователя'
		: 'Деактивировать пользователя'
	const activationConfirmTitle = isDeactivated
		? 'Активировать пользователя?'
		: 'Деактивировать пользователя?'
	const activationConfirmMessage = isDeactivated
		? 'Пользователь снова сможет входить в аккаунт. Повторная активация считается новым согласием на обработку персональных данных.'
		: 'Пользователь не сможет входить в аккаунт, его refresh token будет сброшен, рассылки будут запрещены.'
	const revokedAtLabel = data?.personalDataConsentRevokedAt
		? formatDateTime(data.personalDataConsentRevokedAt)
		: null
	const isUserChecked = true
	const isAdminChecked = Boolean(watch('isAdmin'))
	const isDevChecked = Boolean(watch('isDev'))
	const currentUserIsDev = Boolean(
		currentUser?.rights?.includes(UserRole.DEV)
	)
	const targetIsDev = Boolean(data?.rights.includes(UserRole.DEV))
	const isEditingCurrentUser = Boolean(
		data?.id && currentUser?.id === data.id
	)
	const devRoleRestriction = !currentUserIsDev
		? 'Изменять роль DEV может только пользователь с ролью DEV.'
		: isEditingCurrentUser && targetIsDev
			? 'Нельзя снять роль DEV с собственной учётной записи.'
			: null
	const canManageDevRole = !devRoleRestriction
	const activationRestriction =
		targetIsDev && !currentUserIsDev
			? 'Изменять статус пользователя с ролью DEV может только DEV.'
			: !isDeactivated && isEditingCurrentUser
				? 'Нельзя деактивировать собственную учётную запись.'
				: null
	const isPhoneVerifiedChecked = Boolean(watch('isPhoneVerified'))
	const hasPhoneValue = Boolean(
		(watch('phone') ?? data?.phone ?? '').trim()
	)
	const handleUserSubmit = (formValues: UserEditForm) => {
		const values = { ...formValues }
		delete values.avatarPreview

		return onSubmit(
			canManageDevRole ? values : { ...values, isDev: undefined }
		)
	}
	const handleDeleteAvatar = () => deleteAvatar()
	const autoRenewalDialog = autoRenewalDialogAction
		? AUTO_RENEWAL_DIALOGS[autoRenewalDialogAction]
		: null
	const isAutoRenewalReasonRequired = Boolean(
		autoRenewalDialog?.reasonLabel
	)
	const isAutoRenewalReasonValid =
		!isAutoRenewalReasonRequired || autoRenewalReason.trim().length >= 3

	const openAutoRenewalDialog = (action: AdminAutoRenewalAction) => {
		setAutoRenewalReason('')
		setAutoRenewalDialogAction(action)
	}

	const closeAutoRenewalDialog = () => {
		if (isAutoRenewalUpdating) return

		setAutoRenewalDialogAction(null)
		setAutoRenewalReason('')
	}

	const handleAutoRenewalConfirm = async () => {
		if (!autoRenewalDialogAction || !isAutoRenewalReasonValid) return

		let input: AdminAutoRenewalActionInput
		if (autoRenewalDialogAction === 'reconcile') {
			input = { action: 'reconcile' }
		} else {
			input = {
				action: autoRenewalDialogAction,
				reason: autoRenewalReason.trim()
			}
		}

		try {
			await manageAutoRenewal(input)
			setAutoRenewalDialogAction(null)
			setAutoRenewalReason('')
		} catch {
			// Ошибка уже показана тем же react-hot-toast в mutation.
		}
	}

	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text="Редактирование пользователя"
				title="Редактирование пользователя"
				description="Экран меняет профиль, контакты, роли, статус телефона и пароль конкретного аккаунта."
				risk="high"
				riskText="Ошибка может выдать лишние права, убрать доступ или изменить данные входа. Перед сохранением сверяй пользователя и поля."
			/>

			{isActivationConfirmOpen && data && (
				<ConfirmDialog
					title={activationConfirmTitle}
					message={activationConfirmMessage}
					confirmLabel={activationActionLabel}
					onCancel={() => setIsActivationConfirmOpen(false)}
					onConfirm={() => {
						setIsActivationConfirmOpen(false)
						void toggleActivation()
					}}
				/>
			)}

			{autoRenewalDialogAction && autoRenewalDialog && data && (
				<ConfirmDialog
					title={autoRenewalDialog.title}
					message={autoRenewalDialog.message}
					confirmLabel={
						isAutoRenewalUpdating
							? 'Выполняется...'
							: autoRenewalDialog.confirmLabel
					}
					confirmDisabled={
						isAutoRenewalUpdating || !isAutoRenewalReasonValid
					}
					onCancel={closeAutoRenewalDialog}
					onConfirm={() => void handleAutoRenewalConfirm()}
				>
					{autoRenewalDialog.reasonLabel && (
						<div className={styles.confirmReason}>
							<label
								htmlFor="auto-renewal-reason"
								className={styles.confirmReasonLabel}
							>
								{autoRenewalDialog.reasonLabel}
							</label>
							<textarea
								id="auto-renewal-reason"
								className={styles.confirmReasonInput}
								value={autoRenewalReason}
								maxLength={500}
								disabled={isAutoRenewalUpdating}
								placeholder={autoRenewalDialog.reasonPlaceholder}
								onChange={event =>
									setAutoRenewalReason(event.target.value)
								}
							/>
							<p className={styles.confirmReasonHint}>
								Обязательное поле, минимум 3 символа. Причина попадёт в
								журнал событий.
							</p>
						</div>
					)}
				</ConfirmDialog>
			)}

			{isLoading ? (
				<div className={styles.layout}>
					<div className={clsx(styles.card, styles.summaryCard)}>
						<div className={styles.cardHeader}>
							<div>
								<SkeletonLoader
									count={1}
									className={styles.loadingEyebrow}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingTitle}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingSubtitle}
								/>
							</div>
							<SkeletonLoader
								count={1}
								className={styles.loadingBackButton}
							/>
						</div>
						<div className={styles.cardBody}>
							<div className={styles.loadingUserInfo}>
								<SkeletonLoader
									count={1}
									circle
									className={styles.loadingAvatar}
								/>
								<div className={styles.loadingUserMeta}>
									<SkeletonLoader
										count={1}
										className={styles.loadingUserName}
									/>
									<SkeletonLoader
										count={1}
										className={styles.loadingUserContact}
									/>
								</div>
							</div>
							<div className={styles.loadingBadgeRow}>
								<SkeletonLoader
									count={1}
									className={styles.loadingBadge}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingBadge}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingBadge}
								/>
							</div>
							<div className={styles.loadingInfoGrid}>
								<SkeletonLoader
									count={1}
									className={styles.loadingInfoWide}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingInfoCard}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingInfoCard}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingInfoCard}
								/>
							</div>
						</div>
					</div>

					<div className={styles.card}>
						<div className={styles.cardHeader}>
							<div>
								<SkeletonLoader
									count={1}
									className={styles.loadingEyebrow}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingTitle}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingSubtitle}
								/>
							</div>
						</div>
						<div className={styles.form}>
							<div className={styles.loadingSection}>
								<SkeletonLoader
									count={1}
									className={styles.loadingSectionTitle}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingSectionHint}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingUpload}
								/>
								<div className={styles.loadingRightsGrid}>
									<SkeletonLoader
										count={1}
										className={styles.loadingRightCard}
									/>
									<SkeletonLoader
										count={1}
										className={styles.loadingRightCard}
									/>
									<SkeletonLoader
										count={1}
										className={styles.loadingRightCard}
									/>
								</div>
							</div>
							<div className={styles.loadingSection}>
								<SkeletonLoader
									count={1}
									className={styles.loadingSectionTitle}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingSectionHint}
								/>
								<div className={styles.loadingFieldGrid}>
									<SkeletonLoader
										count={1}
										className={styles.loadingInput}
									/>
									<SkeletonLoader
										count={1}
										className={styles.loadingInput}
									/>
									<SkeletonLoader
										count={1}
										className={styles.loadingInput}
									/>
									<SkeletonLoader
										count={1}
										className={styles.loadingInput}
									/>
								</div>
							</div>
							<div className={styles.loadingActions}>
								<SkeletonLoader
									count={1}
									className={styles.loadingActionsNote}
								/>
								<SkeletonLoader
									count={1}
									className={styles.loadingSaveButton}
								/>
							</div>
						</div>
					</div>
				</div>
			) : data ? (
				<div className={styles.layout}>
					<aside className={clsx(styles.card, styles.summaryCard)}>
						<div className={styles.cardHeader}>
							<div>
								<p className={styles.cardEyebrow}>Профиль</p>
								<h3 className={styles.cardTitle}>
									{data.name || 'Пользователь без имени'}
								</h3>
								<p className={styles.cardSubtitle}>
									Редактирование карточки пользователя и прав доступа.
								</p>
							</div>
							<Link
								href={ADMIN_PAGES.USER_LIST}
								className={styles.backLink}
							>
								К списку
							</Link>
						</div>

						<div className={styles.cardBody}>
							<UserInfo
								avatarPath={data.avatarPath}
								name={data.name}
								isLoading={false}
							/>

							<p className={styles.summaryContact}>
								{data.email ||
									data.phone ||
									'Контактные данные не указаны'}
							</p>

							<div className={styles.summaryGroup}>
								<p className={styles.summaryLabel}>Способы входа</p>
								<div className={styles.badgeRow}>
									{loginMethods.length ? (
										loginMethods.map(method => (
											<span key={method} className={styles.badge}>
												{method}
											</span>
										))
									) : (
										<span
											className={clsx(styles.badge, styles.badgeMuted)}
										>
											Не привязаны
										</span>
									)}
								</div>
							</div>

							<div className={styles.summaryGroup}>
								<p className={styles.summaryLabel}>Права и статусы</p>
								<div className={styles.badgeRow}>
									{data.rights.length ? (
										data.rights.map(role => (
											<span key={role} className={styles.badge}>
												{role}
											</span>
										))
									) : (
										<span
											className={clsx(styles.badge, styles.badgeMuted)}
										>
											Роли не назначены
										</span>
									)}
									{data.isPhoneVerified && (
										<span
											className={clsx(styles.badge, styles.badgeSuccess)}
										>
											Телефон подтверждён
										</span>
									)}
									<span
										className={clsx(
											styles.badge,
											isDeactivated
												? styles.badgeDanger
												: styles.badgeSuccess
										)}
									>
										{isDeactivated ? 'Деактивирован' : 'Активен'}
									</span>
								</div>
							</div>

							<div className={styles.infoGrid}>
								<div
									className={clsx(styles.infoItem, styles.infoItemWide)}
								>
									<p className={styles.infoLabel}>ID пользователя</p>
									<p className={styles.infoValue}>{data.id}</p>
								</div>
								<div className={styles.infoItem}>
									<p className={styles.infoLabel}>Email</p>
									<p className={styles.infoValue}>
										{data.email || 'Нет данных'}
									</p>
								</div>
								<div className={styles.infoItem}>
									<p className={styles.infoLabel}>Телефон</p>
									<p className={styles.infoValue}>
										{data.phone || 'Нет данных'}
									</p>
								</div>
								<div className={styles.infoItem}>
									<p className={styles.infoLabel}>Дата регистрации</p>
									<p className={styles.infoValue}>
										{formatCreatedAt(data.createdAt)}
									</p>
								</div>
								{revokedAtLabel && (
									<div className={styles.infoItem}>
										<p className={styles.infoLabel}>Согласие отозвано</p>
										<p className={styles.infoValue}>{revokedAtLabel}</p>
									</div>
								)}
							</div>

							<UserOverview360
								overview={overview}
								isLoading={isOverviewLoading}
								userId={data.id}
							/>
						</div>
					</aside>

					<div className={styles.card}>
						<div className={styles.cardHeader}>
							<div>
								<p className={styles.cardEyebrow}>Изменения</p>
								<h3 className={styles.cardTitle}>Редактируемые поля</h3>
								<p className={styles.cardSubtitle}>
									Обновите фото, контакты, роли и пароль в одном месте.
								</p>
							</div>
						</div>

						<form
							onSubmit={handleSubmit(handleUserSubmit)}
							className={styles.form}
						>
							<div className={styles.formSection}>
								<div>
									<div className={styles.titleWithHelp}>
										<p className={styles.sectionTitle}>Фото и доступ</p>
										<AdminTooltip
											title="Фото и доступ"
											description="Здесь меняется аватар, базовая роль пользователя, роль администратора и статус подтверждения телефона."
											risk="high"
											riskText="Роль ADMIN даёт доступ к панели администратора. Роль DEV может выдавать только другой DEV. Статус телефона лучше менять только после проверки номера."
										/>
									</div>
									<p className={styles.sectionHint}>
										Аватар меняется отдельно, а права и статусы применяются
										после сохранения формы.
									</p>
								</div>

								<Controller
									control={control}
									name="avatarPreview"
									defaultValue=""
									render={({ field: { value, onChange } }) => (
										<FieldUploadFile
											onChange={onChange}
											onUpload={uploadAvatar}
											value={value}
											currentFile={
												data.avatarPath || '/avatar-default.png'
											}
											placeholder="Фото профиля"
											canDelete
											onDelete={handleDeleteAvatar}
											uploadSuccessMessage="Фото профиля обновлено"
											showFilePath
										/>
									)}
								/>

								<div className={styles.rightsGrid}>
									<div
										className={clsx(
											styles.rightCard,
											isUserChecked && styles.rightCardActive
										)}
									>
										<div>
											<p className={styles.rightCardTitle}>USER</p>
											<p className={styles.rightCardDescription}>
												Базовая роль всегда активна для аккаунта и не
												снимается вручную.
											</p>
										</div>
										<input
											id="user-role-user"
											type="checkbox"
											className={styles.rightCheckbox}
											checked={isUserChecked}
											disabled
											readOnly
											aria-label="Роль USER"
										/>
									</div>

									<label
										className={clsx(
											styles.rightCard,
											isAdminChecked && styles.rightCardActive
										)}
									>
										<div>
											<p className={styles.rightCardTitle}>ADMIN</p>
											<p className={styles.rightCardDescription}>
												Доступ к панели администратора, пользователям и
												настройкам сайта.
											</p>
										</div>
										<input
											type="checkbox"
											className={styles.rightCheckbox}
											{...register('isAdmin')}
										/>
									</label>

									<label
										className={clsx(
											styles.rightCard,
											!canManageDevRole && styles.rightCardDisabled,
											isDevChecked && styles.rightCardActive
										)}
									>
										<div>
											<p className={styles.rightCardTitle}>DEV</p>
											<p className={styles.rightCardDescription}>
												{devRoleRestriction ??
													'Права разработчика с расширенными правами админа. Включает ADMIN автоматически.'}
											</p>
										</div>
										<input
											type="checkbox"
											className={styles.rightCheckbox}
											disabled={!canManageDevRole}
											{...register('isDev')}
										/>
									</label>

									<label
										className={clsx(
											styles.rightCard,
											styles.statusCard,
											!hasPhoneValue && styles.rightCardDisabled,
											hasPhoneValue &&
												isPhoneVerifiedChecked &&
												styles.rightCardActive
										)}
									>
										<div>
											<p className={styles.rightCardTitle}>
												Телефон подтверждён
											</p>
											<p className={styles.rightCardDescription}>
												{hasPhoneValue
													? 'Используйте переключатель, чтобы отметить номер как подтверждённый.'
													: 'Статус станет доступен после добавления номера телефона.'}
											</p>
										</div>
										<input
											type="checkbox"
											className={styles.rightCheckbox}
											disabled={!hasPhoneValue}
											{...register('isPhoneVerified')}
										/>
									</label>
								</div>
							</div>

							<div className={styles.formSection}>
								<div>
									<div className={styles.titleWithHelp}>
										<p className={styles.sectionTitle}>Основные данные</p>
										<AdminTooltip
											title="Основные данные"
											description="Контактные поля используются для отображения профиля и могут участвовать во входе пользователя."
											risk="medium"
											riskText="Неверный email или телефон может помешать пользователю войти или получить важные уведомления."
										/>
									</div>
									<p className={styles.sectionHint}>
										ID доступен только для просмотра. Имя, email и телефон
										можно обновить здесь же.
									</p>
								</div>

								<div className={styles.fieldGrid}>
									<div className={styles.fieldBlock}>
										<label htmlFor="user-id" className={styles.fieldLabel}>
											ID пользователя
										</label>
										<p className={styles.fieldHint}>
											Идентификатор создаётся системой и не редактируется.
										</p>
										<FieldId
											id="user-id"
											type="text"
											defaultValue={data.id}
											placeholder="ID"
											style={FIELD_STYLE}
										/>
									</div>

									<div className={styles.fieldBlock}>
										<label
											htmlFor="user-name"
											className={styles.fieldLabel}
										>
											Имя
										</label>
										<p className={styles.fieldHint}>
											Оставьте пустым, если имя не нужно отображать.
										</p>
										<FieldName
											id="user-name"
											type="text"
											error={errors.name}
											placeholder="Имя"
											style={FIELD_STYLE}
											{...register('name', {
												validate: value =>
													formatOptionalPattern(
														value,
														validName,
														'Имя должно начинаться с буквы. Можно использовать буквы, цифры, пробелы, дефис, апостроф и точку.'
													)
											})}
										/>
									</div>

									<div className={styles.fieldBlock}>
										<label
											htmlFor="user-email"
											className={styles.fieldLabel}
										>
											Email
										</label>
										<p className={styles.fieldHint}>
											Можно заменить текущий адрес или очистить поле.
										</p>
										<FieldEmail
											id="user-email"
											type="email"
											error={errors.email}
											placeholder="Email"
											style={FIELD_STYLE}
											{...register('email', {
												validate: value =>
													formatOptionalPattern(
														value,
														validEmail,
														'Проверьте правильность ввода email'
													)
											})}
										/>
									</div>

									<div className={styles.fieldBlock}>
										<label
											htmlFor="user-phone"
											className={styles.fieldLabel}
										>
											Телефон
										</label>
										<p className={styles.fieldHint}>
											Используется для входа и статуса подтверждения
											номера.
										</p>
										<FieldPhone
											id="user-phone"
											error={errors.phone}
											placeholder="Телефон"
											style={FIELD_STYLE}
											{...register('phone', {
												validate: value =>
													formatOptionalPattern(
														value,
														validPhone,
														'Проверьте правильность ввода номера телефона'
													)
											})}
										/>
									</div>
								</div>
							</div>

							<div className={styles.formSection}>
								<div>
									<div className={styles.titleWithHelp}>
										<p className={styles.sectionTitle}>Безопасность</p>
										<AdminTooltip
											title="Пароль пользователя"
											description="Позволяет задать новый пароль для аккаунта. Пустое поле означает, что пароль останется прежним."
											risk="high"
											riskText="Новый пароль сразу меняет данные входа. Меняй его только по запросу пользователя или при понятной админской необходимости."
										/>
									</div>
									<p className={styles.sectionHint}>
										Оставьте поле пустым, если пароль менять не нужно.
									</p>
								</div>

								<div className={styles.fieldGrid}>
									<div
										className={clsx(
											styles.fieldBlock,
											styles.fieldBlockWide
										)}
									>
										<label
											htmlFor="user-password"
											className={styles.fieldLabel}
										>
											Новый пароль
										</label>
										<p className={styles.fieldHint}>
											Минимум 6 символов, одна цифра, строчная и заглавная
											буква.
										</p>
										<FieldPassword
											id="user-password"
											type="password"
											error={errors.password}
											placeholder="Пароль"
											style={FIELD_STYLE}
											{...register('password', {
												validate: value =>
													formatOptionalPattern(
														value,
														validPassword,
														'Мин. длина 6 символов. Должен содержать 1 цифру 0-9, 1 строчную букву a-z и 1 заглавную букву A-Z.'
													)
											})}
										/>
									</div>
								</div>
							</div>

							<div className={styles.formSection}>
								<div>
									<div className={styles.titleWithHelp}>
										<p className={styles.sectionTitle}>Статус аккаунта</p>
										<AdminTooltip
											title="Статус аккаунта"
											description="Деактивация запрещает вход и исключает пользователя из рассылок."
											risk="high"
											riskText="Активируйте аккаунт обратно только после обращения пользователя. Повторная активация означает новое согласие на обработку персональных данных."
										/>
									</div>
									<p className={styles.sectionHint}>
										{activationRestriction ??
											'Текущий статус меняется отдельным подтверждаемым действием и не зависит от сохранения формы.'}
									</p>
								</div>

								<div
									className={clsx(
										styles.activationPanel,
										isDeactivated && styles.activationPanelDanger
									)}
								>
									<div>
										<p className={styles.activationTitle}>
											{isDeactivated
												? 'Аккаунт деактивирован'
												: 'Аккаунт активен'}
										</p>
										<p className={styles.activationText}>
											{isDeactivated
												? 'Пользователь не может войти и не попадает в рассылки.'
												: 'Пользователь может входить в аккаунт и получать рассылки по выбранной аудитории.'}
										</p>
									</div>
									<button
										type="button"
										className={clsx(
											styles.activationButton,
											isDeactivated
												? styles.activateButton
												: styles.deactivateButton
										)}
										disabled={
											isActivationUpdating ||
											Boolean(activationRestriction)
										}
										onClick={() => setIsActivationConfirmOpen(true)}
									>
										{isActivationUpdating
											? 'Обновляем...'
											: activationActionLabel}
									</button>
								</div>
							</div>

							<AutoRenewalSection
								autoRenewal={autoRenewal}
								isLoading={isAutoRenewalLoading}
								isError={isAutoRenewalError}
								isDev={currentUserIsDev}
								isUpdating={isAutoRenewalUpdating}
								pendingAction={autoRenewalUpdatingAction}
								onAction={openAutoRenewalDialog}
							/>

							<div className={styles.actions}>
								<p className={styles.actionsNote}>
									После сохранения страница вернёт вас к общему списку
									пользователей.
								</p>
								<button
									type="submit"
									className={styles.saveButton}
									disabled={isSaving}
								>
									{isSaving ? 'Сохраняем...' : 'Сохранить изменения'}
								</button>
							</div>
						</form>
					</div>
				</div>
			) : (
				<div className={styles.emptyState}>
					<p className={styles.emptyTitle}>Пользователь не найден</p>
					<p className={styles.emptyText}>
						Проверьте ссылку или вернитесь к списку пользователей.
					</p>
					<Link
						href={ADMIN_PAGES.USER_LIST}
						className={styles.emptyAction}
					>
						К списку пользователей
					</Link>
				</div>
			)}
		</section>
	)
}

export default UserEdit
