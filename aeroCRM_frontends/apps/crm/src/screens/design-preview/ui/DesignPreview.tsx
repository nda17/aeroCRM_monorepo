'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SetStateAction } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import { BrandLogo } from '@/shared/ui/brand-logo'
import { Drawer } from '@/shared/ui/drawer'
import { DirtyFormProvider } from '@/shared/lib/dirty-form'
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
import type {
	PreviewTask,
	PreviewThread,
	PreviewContact
} from '../model/workspace-data'
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
import {
	calendarToday,
	taskDate,
	taskTime,
	taskOverdue
} from '../model/preview-dates'
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
	const [deals, setDeals] = useState<PreviewDeal[]>(() =>
		PREVIEW_DEALS.map(deal => ({
			...deal,
			contactId: PREVIEW_CONTACTS.find(
				contact =>
					contact.name === deal.contact && contact.company === deal.company
			)?.id
		}))
	)
	const [calendarPreferences, setCalendarPreferences] = useState({
		timeZone: 'Europe/Moscow',
		weekStart: 'monday'
	})
	const [tasks, setTasks] = useState(PREVIEW_TASKS)
	const today = calendarToday(calendarPreferences.timeZone)
	const taskDeadline = (task: PreviewTask) => {
		const date = taskDate(task, today)
		return date === null ? Infinity : date + taskTime(task) * 60_000
	}
	const displayDeals: PreviewDeal[] = deals.map(deal => {
		const linkedTasks = tasks.filter(task => task.dealId === deal.id)
		const nextTask = linkedTasks
			.filter(task => task.status !== 'done')
			.sort((left, right) => {
				const leftDeadline = taskDeadline(left)
				const rightDeadline = taskDeadline(right)
				return leftDeadline === rightDeadline
					? left.id.localeCompare(right.id)
					: leftDeadline - rightDeadline
			})[0]
		return {
			...deal,
			task:
				nextTask?.title ??
				(linkedTasks.length
					? 'Следующий шаг выполнен'
					: 'Назначить следующий шаг'),
			due:
				nextTask?.due ?? (linkedTasks.length ? 'Выполнено' : 'Без срока'),
			nextTaskId: nextTask?.id,
			nextTaskOwner: nextTask?.owner,
			overdue: nextTask
				? taskOverdue(nextTask, calendarPreferences.timeZone)
				: false
		}
	})
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
		if (window.location.hash === `#${key}`) return
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
					overdue: deal.overdue
				})),
			...items
		])
	}
	const updateTasks = (action: SetStateAction<PreviewTask[]>) => {
		setTasks(action)
	}
	const completeTask = (taskId: string) => {
		setTasks(items =>
			items.map(task =>
				task.id === taskId ? { ...task, status: 'done' as const } : task
			)
		)
	}
	const updateContacts = (action: SetStateAction<PreviewContact[]>) => {
		const next = typeof action === 'function' ? action(contacts) : action
		setContacts(next)
		setDeals(items =>
			items.map(deal => {
				const contact = next.find(item => item.id === deal.contactId)
				return contact
					? { ...deal, company: contact.company, contact: contact.name }
					: deal
			})
		)
		setTasks(items =>
			items.map(task => {
				const deal = deals.find(item => item.id === task.dealId)
				const contact = next.find(item => item.id === deal?.contactId)
				return contact ? { ...task, company: contact.company } : task
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
					createdAt: new Date().toISOString(),
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
							preview: thread.body,
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
		<div
			className={styles.preview}
			data-preview-theme={theme}
			onKeyDownCapture={event => {
				if (event.key !== 'Tab' || !(event.target instanceof HTMLElement))
					return
				const dialog = event.target.closest('dialog[open]')
				if (!dialog) return
				const controls = Array.from(
					dialog.querySelectorAll<HTMLElement>(
						'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
					)
				).filter(
					control =>
						control.getClientRects().length > 0 &&
						control.closest('dialog') === dialog
				)
				const first = controls[0]
				const last = controls[controls.length - 1]
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault()
					last?.focus()
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault()
					first?.focus()
				}
			}}
		>
			<DirtyFormProvider owner="design-preview">
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
						<span className={styles.workspaceMark}>
							{workspaceName[0]}
						</span>
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
								deals={displayDeals}
								contacts={contacts}
								onCompleteTask={completeTask}
								setDeals={updateDeals}
								selectedDealId={selectedDealId}
								onSelectDeal={setSelectedDealId}
							/>
						</div>
						<div hidden={section !== 'tasks'}>
							<PreviewTasks
								calendarPreferences={calendarPreferences}
								active={section === 'tasks'}
								tasks={tasks}
								deals={displayDeals}
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
								setContacts={updateContacts}
								deals={displayDeals}
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
								<PreviewAnalytics
									deals={displayDeals}
									timeZone={calendarPreferences.timeZone}
								/>
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
									onCalendarPreferencesChange={setCalendarPreferences}
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
			</DirtyFormProvider>
		</div>
	)
}
