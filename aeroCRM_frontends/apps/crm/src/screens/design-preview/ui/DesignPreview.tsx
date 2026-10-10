'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SetStateAction } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import { BrandLogo } from '@/shared/ui/brand-logo'
import { Drawer } from '@/shared/ui/drawer'
import { CRM_NAVIGATION } from '@/widgets/crm-app-shell/model/crm-navigation'
import { PREVIEW_DEALS } from '../model/preview-data'
import type { PreviewDeal } from '../model/preview-data'
import {
	PREVIEW_TASKS,
	PREVIEW_CONTACTS,
	PREVIEW_PRODUCTS,
	PREVIEW_EMPLOYEES,
	PREVIEW_THREADS
} from '../model/workspace-data'
import type { PreviewTask, PreviewThread } from '../model/workspace-data'
import PreviewDeals from './PreviewDeals'
import PreviewAnalytics from './PreviewAnalytics'
import PreviewSettings from './PreviewSettings'
import PreviewCommunications from './PreviewCommunications'
import {
	PreviewTasks,
	PreviewContacts,
	PreviewCatalog,
	PreviewDirectory
} from './PreviewOperations'
import styles from './DesignPreview.module.scss'

const sectionKeys = CRM_NAVIGATION.map(item => item.href.slice(1))
const readSection = () =>
	sectionKeys.includes(window.location.hash.slice(1))
		? window.location.hash.slice(1)
		: 'deals'
const subscribeSection = (notify: () => void) => {
	window.addEventListener('hashchange', notify)
	return () => window.removeEventListener('hashchange', notify)
}

export default function DesignPreview() {
	const section = useSyncExternalStore(
		subscribeSection,
		readSection,
		() => 'deals'
	)
	useEffect(() => {
		window.scrollTo(0, 0)
	}, [section])
	const [theme, setTheme] = useState<'light' | 'dark'>('dark')
	const [workspaceName, setWorkspaceName] = useState('Студия Север')
	const [deals, setDeals] = useState(PREVIEW_DEALS)
	const [tasks, setTasks] = useState(PREVIEW_TASKS)
	const [contacts, setContacts] = useState(PREVIEW_CONTACTS)
	const [products, setProducts] = useState(PREVIEW_PRODUCTS)
	const [threads, setThreads] = useState(PREVIEW_THREADS)
	const [selectedDealId, setSelectedDealId] = useState<string | null>(null)
	const [selectedThreads, setSelectedThreads] = useState<
		Record<PreviewThread['channel'], string | null>
	>({ mail: null, inbox: null, chat: null })
	const [mobileNav, setMobileNav] = useState(false)
	useEffect(() => {
		const closeMenu = () => setMobileNav(false)
		window.addEventListener('hashchange', closeMenu)
		return () => window.removeEventListener('hashchange', closeMenu)
	}, [])
	const label =
		CRM_NAVIGATION.find(item => item.href === `/${section}`)?.label ??
		'Сделки'
	const navigate = (key: string) => {
		setMobileNav(false)
		setSelectedDealId(null)
		window.history.pushState(null, '', `#${key}`)
		window.dispatchEvent(new HashChangeEvent('hashchange'))
	}
	const openDeal = (id: string) => {
		navigate('deals')
		setSelectedDealId(id)
	}
	const updateDeals = (action: SetStateAction<PreviewDeal[]>) => {
		const next = typeof action === 'function' ? action(deals) : action
		setDeals(next)
		setTasks(items => [
			...next
				.filter(deal => !deals.some(item => item.id === deal.id))
				.map(deal => ({
					id: `task-${deal.id}`,
					title: deal.task,
					company: deal.company,
					owner: deal.owner,
					dealId: deal.id,
					status: 'todo' as const,
					priority: 'normal' as const,
					due: deal.due,
					day: 0,
					overdue: deal.overdue
				})),
			...items.map(task => {
				const previous = deals.find(deal => deal.id === task.dealId)
				const current = next.find(deal => deal.id === task.dealId)
				return current?.due === 'Выполнено' &&
					previous?.due !== 'Выполнено'
					? { ...task, status: 'done' as const }
					: task
			})
		])
	}
	const updateTasks = (action: SetStateAction<PreviewTask[]>) => {
		const next = typeof action === 'function' ? action(tasks) : action
		setTasks(next)
		setDeals(items =>
			items.map(deal => {
				const task = next.find(item => item.dealId === deal.id)
				const previous = tasks.find(item => item.id === task?.id)
				if (
					!task ||
					!previous ||
					(task.status === previous.status &&
						task.title === previous.title &&
						task.due === previous.due)
				)
					return deal
				return {
					...deal,
					task:
						task.status === 'done' ? 'Следующий шаг выполнен' : task.title,
					due: task.status === 'done' ? 'Выполнено' : task.due,
					overdue:
						task.status !== 'done' &&
						(task.overdue ?? task.due.includes('Вчера'))
				}
			})
		)
	}
	const acceptThread = (thread: PreviewThread) => {
		let dealId = thread.dealId
		if (!dealId) {
			dealId = `deal-${Date.now()}`
			updateDeals(items => [
				{
					id: dealId!,
					title: thread.subject,
					company: thread.company,
					contact: thread.name,
					initials: thread.name.slice(0, 2),
					amount: 0,
					stage: 0,
					owner: PREVIEW_EMPLOYEES[0].name,
					ownerInitials: PREVIEW_EMPLOYEES[0].initials,
					task: 'Связаться с клиентом',
					due: 'Без срока',
					overdue: false,
					source: 'Обращение'
				},
				...items
			])
		}
		setThreads(items =>
			items.map(item =>
				item.id === thread.id
					? { ...item, status: 'accepted', unread: false, dealId }
					: item
			)
		)
	}
	const copyToInbox = (thread: PreviewThread) => {
		const id = `copy-${thread.id}`
		setThreads(items =>
			items.some(item => item.id === id)
				? items
				: [
						{
							...thread,
							id,
							channel: 'inbox',
							status: 'new',
							unread: true,
							time: 'Сейчас'
						},
						...items
					]
		)
	}
	const messageEmployee = (name: string) => {
		let thread = threads.find(
			item => item.channel === 'chat' && item.name === name
		)
		if (!thread) {
			thread = {
				id: `chat-${Date.now()}`,
				name,
				company: workspaceName,
				subject: 'Личный диалог',
				preview: 'Новый диалог',
				body: '',
				channel: 'chat',
				time: 'Сейчас',
				unread: false,
				status: 'accepted',
				dealId: null
			}
			setThreads(items => [thread!, ...items])
		}
		setThreads(items =>
			items.map(item =>
				item.id === thread!.id ? { ...item, unread: false } : item
			)
		)
		setSelectedThreads(items => ({ ...items, chat: thread!.id }))
		navigate('messages')
	}
	const counts: Record<string, number> = {
		tasks: tasks.filter(task => task.status !== 'done').length,
		deals: deals.length,
		inbox: threads.filter(
			item => item.channel === 'inbox' && item.status === 'new'
		).length,
		messages: threads.filter(
			item => item.channel === 'chat' && item.unread
		).length,
		mail: threads.filter(item => item.channel === 'mail' && item.unread)
			.length
	}
	const navigation = (mobile = false) => (
		<nav
			aria-label={mobile ? 'Разделы CRM в меню' : 'Разделы CRM'}
			className={styles.navigation}
		>
			{CRM_NAVIGATION.map(item => {
				const key = item.href.slice(1)
				return (
					<a
						key={key}
						href={`#${key}`}
						aria-current={section === key ? 'page' : undefined}
						onClick={event => {
							event.preventDefault()
							navigate(key)
						}}
					>
						<AppIcon name={item.icon} size={18} />
						<span>{item.label}</span>
						{counts[key] > 0 && (
							<span className={styles.navCount}>{counts[key]}</span>
						)}
					</a>
				)
			})}
		</nav>
	)
	return (
		<div className={styles.preview} data-preview-theme={theme}>
			<a
				href="#preview-main"
				className={styles.skipLink}
				onClick={event => {
					event.preventDefault()
					document.getElementById('preview-main')?.focus()
				}}
			>
				К содержимому
			</a>
			<aside className={styles.sidebar}>
				<div className={styles.brand}>
					<BrandLogo />
				</div>
				<div className={styles.workspace}>
					<span className={styles.workspaceMark}>{workspaceName[0]}</span>
					<span>
						<strong>{workspaceName}</strong>
						<small>Рабочее пространство</small>
					</span>
				</div>
				<span className={styles.navCaption}>РАБОТА</span>
				{navigation()}
				<div className={styles.sidebarFoot}>
					<span className={styles.previewDot} />
					Дизайн-превью<span>Данные только на этом устройстве</span>
				</div>
				<button
					className={styles.profile}
					onClick={() => navigate('settings')}
				>
					<span className={styles.profileAvatar}>АС</span>
					<span>
						<strong>Анна Смирнова</strong>
						<small>Настройки пространства</small>
					</span>
				</button>
			</aside>
			<div className={styles.main}>
				<header className={styles.topbar}>
					<button
						className={styles.mobileMenu}
						aria-label="Открыть меню"
						aria-expanded={mobileNav}
						onClick={() => setMobileNav(true)}
					>
						<AppIcon name="menu" size={21} />
					</button>
					<div className={styles.breadcrumb}>
						{workspaceName}
						<span>/</span>
						<strong>{label}</strong>
					</div>
					<div className={styles.topbarActions}>
						<span className={styles.localBadge}>
							<span />
							Локальный просмотр
						</span>
						<button
							className={styles.themeButton}
							aria-label={
								theme === 'dark'
									? 'Включить светлую тему'
									: 'Включить тёмную тему'
							}
							title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
							onClick={() =>
								setTheme(value => (value === 'dark' ? 'light' : 'dark'))
							}
						>
							<AppIcon
								name={theme === 'dark' ? 'sun' : 'moon'}
								size={17}
							/>
						</button>
					</div>
				</header>
				<div
					id="preview-main"
					tabIndex={-1}
					className={styles.screenMount}
				>
					<div hidden={section !== 'deals'}>
						<PreviewDeals
							active={section === 'deals'}
							deals={deals}
							setDeals={updateDeals}
							selectedDealId={selectedDealId}
							onSelectDeal={setSelectedDealId}
						/>
					</div>
					<div hidden={section !== 'tasks'}>
						<PreviewTasks
							active={section === 'tasks'}
							tasks={tasks}
							setTasks={updateTasks}
							employees={PREVIEW_EMPLOYEES}
							onOpenDeal={openDeal}
						/>
					</div>
					{(['inbox', 'mail', 'chat'] as const).map(channel => (
						<div
							key={channel}
							hidden={
								section !== (channel === 'chat' ? 'messages' : channel)
							}
						>
							<PreviewCommunications
								active={
									section === (channel === 'chat' ? 'messages' : channel)
								}
								channel={channel}
								threads={threads}
								setThreads={setThreads}
								selectedId={selectedThreads[channel]}
								onSelect={id =>
									setSelectedThreads(items => ({
										...items,
										[channel]: id
									}))
								}
								onOpenDeal={openDeal}
								onAccept={acceptThread}
								onCopyToInbox={copyToInbox}
							/>
						</div>
					))}
					<div hidden={section !== 'contacts'}>
						<PreviewContacts
							active={section === 'contacts'}
							contacts={contacts}
							setContacts={setContacts}
							deals={deals}
							onOpenDeal={openDeal}
						/>
					</div>
					<div hidden={section !== 'catalog'}>
						<PreviewCatalog
							active={section === 'catalog'}
							products={products}
							setProducts={setProducts}
						/>
					</div>
					<div hidden={section !== 'analytics'}>
						<main className={styles.content}>
							<PreviewAnalytics deals={deals} />
						</main>
					</div>
					<div hidden={section !== 'directory'}>
						<PreviewDirectory
							active={section === 'directory'}
							employees={PREVIEW_EMPLOYEES}
							onMessage={messageEmployee}
						/>
					</div>
					<div hidden={section !== 'settings'}>
						<main className={styles.content}>
							<PreviewSettings
								workspaceName={workspaceName}
								onWorkspaceNameChange={setWorkspaceName}
								employees={PREVIEW_EMPLOYEES}
								theme={theme}
								onThemeChange={setTheme}
							/>
						</main>
					</div>
				</div>
			</div>
			<Drawer
				isOpen={mobileNav}
				onClose={() => setMobileNav(false)}
				title={workspaceName}
				side="left"
				size="sm"
				className={styles.previewDrawer}
			>
				{navigation(true)}
			</Drawer>
		</div>
	)
}
