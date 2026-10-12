'use client'

import brand from '../../../../../brand/aerocrm-wing.json'
import styles from './AdminFrame.module.scss'
import { useVeilBackgroundStore } from '@/shared/lib/veil-background'
import VeilBackground from '@/shared/ui/veil-background/VeilBackground'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import {
	AdminNavigationGuardProvider,
	useAdminNavigationGuard
} from '@/screens/admin/model/navigation/AdminNavigationGuard'
import {
	adminNavGroups,
	isAdminNavItemActive
} from '@/screens/admin/ui/common/admin-navigation/data/admin-navigation.data'
import { UserRole, useAuthStore, useUser } from '@/entities/user'
import { useLogout } from '@/features/auth'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import { getCrmAppUrl } from '@/shared/config/crm-release.config'
import Link from '@/shared/lib/navigation/ZoneLink'
import { useZoneRouter } from '@/shared/lib/navigation/useZoneRouter'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { usePathname } from 'next/navigation'
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type PropsWithChildren
} from 'react'

const THEME_KEY = 'aerocrm-admin-theme'

export default function AdminFrame({ children }: PropsWithChildren) {
	return (
		<AdminNavigationGuardProvider>
			<AdminFrameContent>{children}</AdminFrameContent>
		</AdminNavigationGuardProvider>
	)
}

function AdminFrameContent({ children }: PropsWithChildren) {
	const pathname = usePathname()
	const router = useZoneRouter()
	const { confirmNavigation } = useAdminNavigationGuard()
	const visible = useVeilBackgroundStore(state => state.visible)
	const { user, isLoading } = useUser()
	const auth = useAuthStore(state => state.auth)
	const { logout, isPending: isLoggingOut } = useLogout()
	const [theme, setTheme] = useState<'light' | 'dark'>('light')
	const [themeReady, setThemeReady] = useState(false)
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [commandOpen, setCommandOpen] = useState(false)
	const [query, setQuery] = useState('')
	const drawerRef = useRef<HTMLElement>(null)
	const shellRef = useRef<HTMLDivElement>(null)
	const menuButtonRef = useRef<HTMLButtonElement>(null)
	const commandRef = useRef<HTMLDialogElement>(null)
	const commandInputRef = useRef<HTMLInputElement>(null)
	const commandButtonRef = useRef<HTMLButtonElement>(null)
	const previousPathRef = useRef(pathname)

	const groups = adminNavGroups
		.map(group => ({
			...group,
			items: group.items.filter(
				item => !item.devOnly || user.rights?.includes(UserRole.DEV)
			)
		}))
		.filter(group => group.items.length > 0)
	const items = groups.flatMap(group => group.items)
	const activeTitle =
		items.find(item => isAdminNavItemActive(pathname, item))?.title ??
		'Панель администратора'
	const matches = items.filter(item =>
		item.title
			.toLocaleLowerCase('ru')
			.includes(query.trim().toLocaleLowerCase('ru'))
	)

	useEffect(() => {
		try {
			if (window.localStorage.getItem(THEME_KEY) === 'dark') {
				document.body.dataset.adminTheme = 'dark'
				setTheme('dark')
			}
		} catch {
			// Storage can be unavailable in private browser contexts.
		}
		setThemeReady(true)
	}, [])

	useEffect(() => {
		if (!themeReady) return
		document.body.dataset.adminTheme = theme
		try {
			window.localStorage.setItem(THEME_KEY, theme)
		} catch {
			// The chosen theme still applies to the current page.
		}
	}, [theme, themeReady])

	useEffect(() => {
		const media = window.matchMedia('(max-width: 760px)')
		const drawer = drawerRef.current
		const shell = shellRef.current
		const updateInert = () => {
			if (drawer) drawer.inert = media.matches && !drawerOpen
			if (shell) shell.inert = media.matches && drawerOpen
			if (!media.matches && drawerOpen) {
				if (
					drawer?.contains(document.activeElement) &&
					document.activeElement?.getAttribute('aria-label') ===
						'Закрыть навигацию'
				) {
					drawer.querySelector<HTMLElement>('a[href]')?.focus()
				}
				setDrawerOpen(false)
			}
		}
		updateInert()
		media.addEventListener('change', updateInert)
		return () => {
			media.removeEventListener('change', updateInert)
			if (drawer) drawer.inert = false
			if (shell) shell.inert = false
		}
	}, [drawerOpen])

	const closeDrawer = useCallback((returnFocus = true) => {
		setDrawerOpen(false)
		if (returnFocus)
			window.requestAnimationFrame(() => menuButtonRef.current?.focus())
	}, [])

	useEffect(() => {
		setDrawerOpen(false)
		setCommandOpen(false)
		if (previousPathRef.current !== pathname) {
			previousPathRef.current = pathname
			window.requestAnimationFrame(() =>
				document.getElementById('admin-main')?.focus()
			)
		}
	}, [pathname])

	useEffect(() => {
		if (!drawerOpen || !window.matchMedia('(max-width: 760px)').matches)
			return
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		window.requestAnimationFrame(() =>
			drawerRef.current
				?.querySelector<HTMLElement>('button, a[href]')
				?.focus()
		)
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault()
				closeDrawer()
			}
			if (event.key !== 'Tab') return
			const focusable = Array.from(
				drawerRef.current?.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled])'
				) ?? []
			)
			if (!focusable.length) return
			if (event.shiftKey && document.activeElement === focusable[0]) {
				event.preventDefault()
				focusable[focusable.length - 1].focus()
			} else if (
				!event.shiftKey &&
				document.activeElement === focusable[focusable.length - 1]
			) {
				event.preventDefault()
				focusable[0].focus()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => {
			document.body.style.overflow = previousOverflow
			window.removeEventListener('keydown', onKeyDown)
		}
	}, [drawerOpen, closeDrawer])

	useEffect(() => {
		if (commandOpen) {
			if (!commandRef.current?.open) commandRef.current?.showModal()
			window.requestAnimationFrame(() => commandInputRef.current?.focus())
		} else if (commandRef.current?.open) commandRef.current.close()
	}, [commandOpen])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLowerCase() === 'k'
			) {
				event.preventDefault()
				setDrawerOpen(false)
				setQuery('')
				setCommandOpen(true)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [])

	const operatorName = user.name || user.email || 'Оператор'
	const operatorInitials = operatorName
		.split(/\s+/)
		.slice(0, 2)
		.map(part => part[0]?.toLocaleUpperCase('ru'))
		.join('')
	const operatorRole = user.rights?.includes(UserRole.DEV)
		? 'Разработчик'
		: user.rights?.includes(UserRole.ADMIN)
			? 'Администратор'
			: 'Оператор'
	const openSearch = () => {
		setQuery('')
		setCommandOpen(true)
	}

	return (
		<div className={`admin-application ${styles.application}`}>
			<a className={styles.skipLink} href="#admin-main">
				К содержимому
			</a>
			{drawerOpen && (
				<button
					type="button"
					className={styles.scrim}
					aria-label="Закрыть навигацию"
					onClick={() => closeDrawer()}
				/>
			)}
			<aside
				ref={drawerRef}
				id="admin-sidebar"
				className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ''}`}
				aria-label="Панель навигации"
				role={drawerOpen ? 'dialog' : undefined}
				aria-modal={drawerOpen ? true : undefined}
			>
				<div className={styles.brand}>
					<Link
						href={ADMIN_PAGES.HOME}
						onClick={() => closeDrawer(false)}
						className={styles.brandLink}
					>
						<svg
							className={styles.brandLogo}
							viewBox={brand.viewBox}
							role="img"
							aria-label="aeroCRM"
						>
							<path d={brand.wing} fill="#efc85b" />
							<path d={brand.wordmark} fill="currentColor" />
						</svg>
						<small>УПРАВЛЕНИЕ ПЛАТФОРМОЙ</small>
					</Link>
					<button
						type="button"
						className={styles.sidebarClose}
						aria-label="Закрыть навигацию"
						onClick={() => closeDrawer()}
					>
						<AppIcon name="close" size={18} />
					</button>
				</div>
				<AdminNavigation shell onNavigate={() => closeDrawer(false)} />
				<div className={styles.sidebarBottom}>
					<Link href={PUBLIC_PAGES.HOME}>
						Публичный сайт <span aria-hidden="true">↗</span>
					</Link>
					<Link href={getCrmAppUrl()}>
						Рабочая CRM <span aria-hidden="true">↗</span>
					</Link>
					{auth && (
						<>
							<Link href={PUBLIC_PAGES.CABINET}>Личный кабинет</Link>
							<Link href={PUBLIC_PAGES.PAYMENT}>Оплата</Link>
						</>
					)}
					{auth && (
						<div className={styles.operator}>
							<span className={styles.avatar} aria-hidden="true">
								{isLoading ? '…' : operatorInitials}
							</span>
							<div>
								<strong>{isLoading ? 'Загрузка…' : operatorName}</strong>
								<small>{operatorRole}</small>
							</div>
						</div>
					)}
					{auth && (
						<button
							type="button"
							className={styles.logout}
							disabled={isLoggingOut}
							onClick={() => confirmNavigation(() => logout())}
						>
							<AppIcon name="logout" size={17} />
							{isLoggingOut ? 'Выходим…' : 'Выйти'}
						</button>
					)}
				</div>
			</aside>
			<div ref={shellRef} className={styles.shell}>
				<header className={styles.topbar}>
					<div className={styles.topbarStart}>
						<button
							ref={menuButtonRef}
							type="button"
							className={styles.menuButton}
							aria-label="Открыть навигацию"
							aria-controls="admin-sidebar"
							aria-expanded={drawerOpen}
							onClick={() => setDrawerOpen(true)}
						>
							<AppIcon name="menu" size={22} />
						</button>
						<span className={styles.breadcrumb}>
							Платформа <span aria-hidden="true">/</span>{' '}
							<strong>{activeTitle}</strong>
						</span>
					</div>
					<div className={styles.topbarActions}>
						<button
							ref={commandButtonRef}
							type="button"
							className={styles.commandButton}
							onClick={openSearch}
							aria-label="Найти раздел"
						>
							<AppIcon name="search" size={18} />
							<span>Перейти к разделу…</span>
							<kbd>⌘ K</kbd>
						</button>
						<button
							type="button"
							className={styles.iconButton}
							onClick={() =>
								setTheme(value => (value === 'light' ? 'dark' : 'light'))
							}
							aria-label={
								theme === 'light'
									? 'Включить тёмную тему'
									: 'Включить светлую тему'
							}
						>
							<span aria-hidden="true">
								{theme === 'light' ? '☾' : '☀'}
							</span>
						</button>
						<Link
							href={ADMIN_PAGES.ALERTS}
							className={styles.iconButton}
							aria-label="Предупреждения"
						>
							<svg
								width="19"
								height="19"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
							</svg>
						</Link>
					</div>
				</header>
				{visible && <VeilBackground />}
				<main id="admin-main" className={styles.main} tabIndex={-1}>
					{children}
				</main>
			</div>
			<dialog
				ref={commandRef}
				className={styles.commandDialog}
				aria-label="Быстрый переход"
				onClose={() => {
					setCommandOpen(false)
					commandButtonRef.current?.focus()
				}}
			>
				<div className={styles.commandHeader}>
					<AppIcon name="search" size={19} />
					<input
						ref={commandInputRef}
						type="search"
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder="Найти раздел…"
						aria-label="Найти раздел"
						onKeyDown={event => {
							if (event.key === 'Enter' && matches[0]) {
								confirmNavigation(() => {
									setCommandOpen(false)
									router.push(matches[0].link)
								})
							}
						}}
					/>
					<button
						type="button"
						onClick={() => setCommandOpen(false)}
						aria-label="Закрыть поиск"
					>
						<AppIcon name="close" size={18} />
					</button>
				</div>
				<div className={styles.commandResults}>
					{matches.length ? (
						matches.map(item => (
							<button
								type="button"
								key={item.link}
								onClick={() =>
									confirmNavigation(() => {
										setCommandOpen(false)
										router.push(item.link)
									})
								}
							>
								{item.title}
							</button>
						))
					) : (
						<p>Разделы не найдены</p>
					)}
				</div>
			</dialog>
		</div>
	)
}
