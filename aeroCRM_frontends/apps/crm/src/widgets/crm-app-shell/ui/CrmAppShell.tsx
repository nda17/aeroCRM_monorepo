'use client'

import styles from '@/widgets/crm-app-shell/ui/CrmAppShell.module.scss'
import {
	CRM_NAVIGATION,
	type CrmNavigationItem
} from '@/widgets/crm-app-shell/model/crm-navigation'
import {
	canReadCrmRoute,
	crmDefaultRoute,
	useCrmPermissions,
	type CrmPermissions,
	useCrmWorkspaceAccess
} from '@/entities/crm-access'
import { getCurrentAccount, useSessionStore } from '@/entities/session'
import { getEmployeeProfile } from '@/entities/crm-team'
import { useWorkspaceBranding } from '@/entities/crm-workspace-branding'
import { getRuntimeConfig } from '@/shared/config/runtime'
import { ThemeSwitcher } from '@/shared/ui/theme-switcher/ThemeSwitcher'
import { TaskNotificationCenter } from '@/features/manage-reminders'
import { CrmNavigationLink } from './CrmNavigationLink'
import {
	AppIcon,
	BrandLogo,
	Drawer,
	HelpHint,
	ReadOnlyBanner,
	StatusBadge,
	ScreenState,
	useTooltip
} from '@/shared/ui'
import clsx from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type PropsWithChildren, useEffect, useId, useState } from 'react'

interface CrmNavigationProps {
	ariaLabel: string
	enabled?: boolean
	onNavigate?: () => void
	authority?: CrmPermissions
}

const isNavigationItemActive = (
	pathname: string,
	item: CrmNavigationItem
) => pathname === item.href || pathname.startsWith(`${item.href}/`)

const CrmNavigation = ({
	ariaLabel,
	enabled = true,
	onNavigate,
	authority
}: CrmNavigationProps) => {
	const pathname = usePathname()

	return (
		<nav aria-label={ariaLabel}>
			<ul className={styles.navigationList}>
				{CRM_NAVIGATION.filter(
					item => authority && canReadCrmRoute(authority, item.href)
				).map(item => {
					const isActive = isNavigationItemActive(pathname, item)

					return (
						<li key={item.href}>
							<CrmNavigationLink
								item={item}
								isActive={isActive}
								enabled={enabled}
								onNavigate={onNavigate}
							/>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}

const CrmMobileNavigation = ({
	authority
}: {
	authority?: CrmPermissions
}) => {
	const [isOpen, setIsOpen] = useState(false)

	return (
		<>
			<button
				type="button"
				className={styles.mobileMenuButton}
				aria-label="Открыть навигацию CRM"
				aria-expanded={isOpen}
				onClick={() => setIsOpen(true)}
			>
				<AppIcon name="menu" size={20} />
			</button>

			<Drawer
				isOpen={isOpen}
				onClose={() => setIsOpen(false)}
				title="Навигация CRM"
				side="left"
			>
				<div className={styles.mobileNavigation}>
					<CrmNavigation
						authority={authority}
						key={String(isOpen)}
						enabled={isOpen}
						ariaLabel="Мобильная навигация CRM"
						onNavigate={() => setIsOpen(false)}
					/>
					<div className={styles.mobileExternalLinks}>
						<a href={`${getRuntimeConfig().mainAppOrigin}/cabinet`}>
							Личный кабинет
						</a>
						<a href={getRuntimeConfig().mainAppOrigin}>На сайт aeroCRM</a>
					</div>
					<p className={styles.mobileCaption}>
						aeroCRM · рабочее пространство
					</p>
				</div>
			</Drawer>
		</>
	)
}

const CrmAppShell = ({ children }: PropsWithChildren) => {
	const pathname = usePathname()
	const access = useCrmWorkspaceAccess()
	const router = useRouter()
	const searchParams = useSearchParams()
	const { session, sessionRevision } = useSessionStore()
	const permissions = useCrmPermissions(
		access.workspaceId,
		session,
		sessionRevision
	)
	const authority =
		permissions.isSuccess &&
		!permissions.isError &&
		permissions.data.subject === session?.userId
			? permissions.data
			: undefined
	const home = authority ? crmDefaultRoute(authority) : '/inbox'
	const entryRedirect =
		pathname === '/inbox' &&
		authority &&
		!canReadCrmRoute(authority, pathname)
	useEffect(() => {
		if (entryRedirect)
			router.replace(
				`${home}${searchParams.size ? `?${searchParams.toString()}` : ''}`
			)
	}, [entryRedirect, home, router, searchParams])
	const branding = useWorkspaceBranding()
	const companyName = branding.data?.branding.displayName
	const profile = useQuery({
		queryKey: [
			'crm-employee-profile',
			access.workspaceId,
			session?.userId,
			sessionRevision,
			authority?.role,
			session?.userId
		],
		enabled: !!session && !!authority,
		queryFn: () =>
			getEmployeeProfile(session!.accessToken, {
				workspaceId: access.workspaceId,
				subject: session!.userId,
				targetSubject: session!.userId
			}),
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	const ownProfile =
		!profile.isError &&
		profile.data?.workspaceId === access.workspaceId &&
		profile.data.subject === session?.userId &&
		profile.data.targetSubject === session?.userId
			? profile.data.profile
			: null
	const account = useQuery({
		queryKey: ['crm-current-account', session?.userId, sessionRevision],
		enabled: !!session && !!authority,
		queryFn: () =>
			getCurrentAccount(session!.accessToken, session!.userId),
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	const profileName = ownProfile
		? [ownProfile.lastName, ownProfile.firstName, ownProfile.middleName]
				.map(value => value?.trim())
				.filter(Boolean)
				.join(' ')
		: ''
	const accountEmail = !account.isError ? account.data?.email?.trim() : ''
	const accountName =
		profileName ||
		(!account.isError ? account.data?.name?.trim() : '') ||
		accountEmail ||
		'Личный кабинет'
	const { mainAppOrigin } = getRuntimeConfig()
	const sidebarId = useId()
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
	const sidebarToggleLabel = isSidebarCollapsed
		? 'Развернуть боковую панель'
		: 'Свернуть боковую панель'
	const sidebarHint = useTooltip<HTMLButtonElement>(
		isSidebarCollapsed
			? 'Показать боковое меню с разделами CRM.'
			: 'Скрыть боковое меню, чтобы освободить место для рабочей области.'
	)
	const sectionItem = CRM_NAVIGATION.find(item =>
		isNavigationItemActive(pathname, item)
	)
	const section = sectionItem?.label ?? 'Рабочее пространство'
	const accessLabel =
		access.state === 'READ_ONLY'
			? 'Только чтение'
			: access.state === 'GRACE'
				? 'Льготный период'
				: 'Доступ активен'
	const membershipLabel =
		access.membership.role === 'OWNER'
			? 'Владелец пространства'
			: 'Участник пространства'

	return (
		<div
			className={clsx(
				styles.shell,
				isSidebarCollapsed && styles.shellCollapsed
			)}
		>
			<a className={styles.skipLink} href="#crm-main-content">
				Перейти к содержимому
			</a>

			<aside
				id={sidebarId}
				className={styles.sidebar}
				aria-label="CRM"
				aria-hidden={isSidebarCollapsed || undefined}
				inert={isSidebarCollapsed}
			>
				<div
					className={clsx(
						styles.sidebarContent,
						isSidebarCollapsed && styles.sidebarContentCollapsed
					)}
				>
					<div className={styles.sidebarBrand}>
						<BrandLogo href={home} />
						{companyName ? (
							<span className={styles.companyName} title={companyName}>
								{companyName}
							</span>
						) : null}
					</div>
					<div className={styles.sidebarNavigation}>
						<CrmNavigation
							key={`${pathname}:${isSidebarCollapsed}`}
							enabled={!isSidebarCollapsed}
							authority={authority}
							ariaLabel="Основная навигация CRM"
						/>
					</div>
					<p className={styles.sidebarCaption}>
						aeroCRM · рабочее пространство
					</p>
				</div>
			</aside>

			<div className={styles.workspace}>
				<header className={styles.topbar}>
					<CrmMobileNavigation key={pathname} authority={authority} />
					<button
						{...sidebarHint.triggerProps}
						type="button"
						className={styles.sidebarToggle}
						aria-label={sidebarToggleLabel}
						title={sidebarToggleLabel}
						aria-controls={sidebarId}
						aria-expanded={!isSidebarCollapsed}
						onClick={event => {
							event.currentTarget.focus({ preventScroll: true })
							sidebarHint.close()
							setIsSidebarCollapsed(collapsed => !collapsed)
						}}
					>
						<AppIcon
							name="chevronDown"
							size={20}
							className={clsx(
								styles.sidebarToggleIcon,
								isSidebarCollapsed && styles.sidebarToggleIconCollapsed
							)}
						/>
					</button>
					{sidebarHint.tooltip}

					<div
						className={styles.sectionContext}
						aria-label="Текущий раздел"
					>
						<div className={styles.mobileBrandGroup}>
							<BrandLogo size="compact" className={styles.mobileBrand} />
							{companyName ? (
								<span
									className={styles.mobileCompanyName}
									title={companyName}
								>
									{companyName}
								</span>
							) : null}
						</div>
						<span className={styles.sectionName}>
							{sectionItem ? (
								<HelpHint
									label={section}
									description={sectionItem.description}
								>
									{section}
								</HelpHint>
							) : (
								section
							)}
						</span>
					</div>
					<ThemeSwitcher />
					<TaskNotificationCenter />
					<a className={styles.siteLink} href={mainAppOrigin}>
						На сайт aeroCRM
					</a>
					<a className={styles.logoutLink} href="/logout">
						Выйти
					</a>

					<div
						className={styles.accessContext}
						aria-label="Доступ к рабочему пространству"
					>
						<div className={styles.accessBadges}>
							<StatusBadge
								tone={
									access.state === 'ACTIVE'
										? 'success'
										: access.state === 'GRACE'
											? 'warning'
											: 'neutral'
								}
							>
								{accessLabel}
							</StatusBadge>
							<StatusBadge tone="neutral" showDot={false}>
								<span className={styles.membershipFull}>
									{membershipLabel}
								</span>
								<span
									className={styles.membershipShort}
									aria-hidden="true"
								>
									{access.membership.role === 'OWNER'
										? 'Владелец'
										: 'Участник'}
								</span>
							</StatusBadge>
						</div>
						<a
							className={styles.accountCard}
							href={`${mainAppOrigin}/cabinet`}
							aria-label={`Личный кабинет — ${accountName}`}
						>
							<span className={styles.accountAvatar} aria-hidden="true">
								<AppIcon name="user" size={24} />
							</span>
							<span className={styles.accountDetails}>
								<span className={styles.accountName} title={accountName}>
									{accountName}
								</span>
								{accountEmail && accountEmail !== accountName ? (
									<span
										className={styles.accountEmail}
										title={accountEmail}
									>
										{accountEmail}
									</span>
								) : null}
							</span>
						</a>
					</div>
				</header>

				<main
					id="crm-main-content"
					className={styles.content}
					tabIndex={-1}
				>
					{access.state === 'GRACE' ? (
						<ReadOnlyBanner
							tone="warning"
							title="Дополнительные 3 дня доступа"
							description={
								<>
									Бесплатный период завершён. Вы можете продолжать работу
									{access.entitlement.graceUntil ? (
										<>
											{' '}
											до{' '}
											<time dateTime={access.entitlement.graceUntil}>
												{new Intl.DateTimeFormat('ru-RU', {
													dateStyle: 'long',
													timeStyle: 'short'
												}).format(new Date(access.entitlement.graceUntil))}
											</time>
										</>
									) : (
										' в течение льготного периода'
									)}
									. Затем CRM останется доступна для просмотра и экспорта.
								</>
							}
						/>
					) : null}
					{access.isReadOnly ? (
						<ReadOnlyBanner
							title="aeroCRM доступна только для чтения"
							description="Данные сохранены. Просмотр доступен, а экспорт — пользователям с соответствующими правами. Для изменений и приёма новых заявок продлите доступ."
						/>
					) : null}
					{entryRedirect ? <ScreenState variant="loading" /> : children}
				</main>
			</div>
		</div>
	)
}

export default CrmAppShell
