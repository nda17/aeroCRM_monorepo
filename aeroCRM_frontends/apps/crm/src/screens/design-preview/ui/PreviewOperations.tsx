'use client'

import { useState } from 'react'
import type { Dispatch, SetStateAction, FormEvent } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import { Drawer } from '@/shared/ui/drawer'
import type { PreviewDeal } from '../model/preview-data'
import type {
	PreviewTask,
	PreviewContact,
	PreviewProduct,
	PreviewEmployee
} from '../model/workspace-data'
import {
	PreviewHeading,
	PreviewForm,
	PreviewDiscardButton,
	PreviewSearch,
	PreviewEmpty,
	PreviewStatus,
	previewInitials,
	previewMoney,
	previewMatches
} from './PreviewPrimitives'
import {
	days,
	calendarDayMs,
	calendarFormat,
	calendarToday,
	taskTime,
	taskDate,
	taskOverdue
} from '../model/preview-dates'
import styles from './DesignPreview.module.scss'

type Setter<T> = Dispatch<SetStateAction<T[]>>
const taskStatuses = {
	todo: 'К выполнению',
	doing: 'В работе',
	done: 'Выполнено'
}
function TaskDeadlineFields({
	date,
	time,
	today
}: {
	date: number | null
	time: string
	today: number
}) {
	const [scheduled, setScheduled] = useState(date !== null)
	return (
		<>
			<label className={styles.settingsRow}>
				<span>Без срока</span>
				<input
					name="unscheduled"
					type="checkbox"
					className={styles.toggle}
					checked={!scheduled}
					onChange={event => setScheduled(!event.target.checked)}
				/>
			</label>
			<div className={styles.formColumns}>
				<label>
					Дата
					<input
						name="date"
						type="date"
						required={scheduled}
						disabled={!scheduled}
						min="0100-01-01"
						max="9999-12-24"
						defaultValue={new Date(date ?? today)
							.toISOString()
							.slice(0, 10)}
					/>
				</label>
				<label>
					Время
					<input
						name="time"
						type="time"
						required={scheduled}
						disabled={!scheduled}
						defaultValue={time}
					/>
				</label>
			</div>
		</>
	)
}

function TaskRelationFields({
	deals,
	task
}: {
	deals: PreviewDeal[]
	task: PreviewTask | null
}) {
	const [dealId, setDealId] = useState(task?.dealId ?? '')
	const [company, setCompany] = useState(task?.company ?? '')
	return (
		<>
			<label>
				Связанная сделка
				<select
					name="dealId"
					value={dealId}
					onChange={event => {
						setDealId(event.target.value)
						const deal = deals.find(item => item.id === event.target.value)
						if (deal) setCompany(deal.company)
					}}
				>
					<option value="">Без привязки к сделке</option>
					{deals.map(deal => (
						<option key={deal.id} value={deal.id}>
							{deal.title} · {deal.company}
						</option>
					))}
				</select>
			</label>
			<label>
				Компания
				<input
					name="company"
					maxLength={100}
					value={company}
					readOnly={Boolean(dealId)}
					onChange={event => setCompany(event.target.value)}
				/>
			</label>
		</>
	)
}

export function PreviewTasks({
	calendarPreferences,
	active = true,
	tasks,
	deals,
	setTasks,
	employees,
	onOpenDeal
}: {
	calendarPreferences: { timeZone: string; weekStart: string }
	active?: boolean
	tasks: PreviewTask[]
	deals: PreviewDeal[]
	setTasks: Setter<PreviewTask>
	employees: PreviewEmployee[]
	onOpenDeal: (id: string) => void
}) {
	const [query, setQuery] = useState('')
	const [view, setView] = useState<'list' | 'calendar'>('list')
	const [status, setStatus] = useState('active')
	const [owner, setOwner] = useState('')
	const [editingId, setEditing] = useState<string | null>(null)
	const editing =
		editingId === 'new'
			? 'new'
			: (tasks.find(task => task.id === editingId) ?? null)
	const [notice, setNotice] = useState('')
	if (!active && editing) setEditing(null)
	const [weekOffset, setWeekOffset] = useState(0)
	const today = calendarToday(calendarPreferences.timeZone)
	const isOverdue = (task: PreviewTask) =>
		taskOverdue(task, calendarPreferences.timeZone)
	const firstWeekday = calendarPreferences.weekStart === 'sunday' ? 0 : 1
	const currentWeekStart =
		today -
		((new Date(today).getUTCDay() - firstWeekday + 7) % 7) * calendarDayMs
	const firstDate = Date.UTC(100, 0, 1)
	const lastDate = Date.UTC(9999, 11, 24)
	const firstWeekOffset = Math.floor(
		(firstDate - currentWeekStart) / (7 * calendarDayMs)
	)
	const lastWeekOffset = Math.floor(
		(lastDate - currentWeekStart) / (7 * calendarDayMs)
	)
	const visibleWeekOffset = Math.max(
		firstWeekOffset,
		Math.min(lastWeekOffset, weekOffset)
	)
	const weekStart =
		currentWeekStart + visibleWeekOffset * 7 * calendarDayMs
	const weekDates = Array.from(
		{ length: 7 },
		(_, index) => weekStart + index * calendarDayMs
	)
	const weekLabel = new Intl.DateTimeFormat('ru-RU', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).formatRange(weekStart, weekDates[6])
	const filtered = tasks.filter(
		task =>
			previewMatches(query, task.title, task.company) &&
			(!owner || task.owner === owner) &&
			(status === 'all' ||
				(status === 'active'
					? task.status !== 'done'
					: status === 'overdue'
						? isOverdue(task)
						: task.status === 'done'))
	)
	const datedTasks = filtered.map(task => ({
		task,
		date: taskDate(task, today)
	}))
	const weekTasks = datedTasks.filter(
		({ date }) =>
			date !== null && date >= weekStart && date <= weekDates[6]
	)
	const unscheduledTasks = datedTasks.filter(({ date }) => date === null)
	const reset = () => {
		setQuery('')
		setOwner('')
		setStatus('active')
	}
	const toggle = (task: PreviewTask) => {
		setTasks(items =>
			items.map(item =>
				item.id === task.id
					? { ...item, status: item.status === 'done' ? 'todo' : 'done' }
					: item
			)
		)
		setNotice(
			task.status === 'done'
				? 'Задача возвращена в работу'
				: 'Задача выполнена'
		)
	}
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const data = new FormData(event.currentTarget)
		const dateValue = String(data.get('date') ?? '')
		const timeValue = String(data.get('time'))
		const [year, month, day] = dateValue.split('-')
		const due = dateValue
			? `${day}.${month}.${year}, ${timeValue}`
			: 'Без срока'
		const task: PreviewTask = {
			id:
				editing && editing !== 'new'
					? editing.id
					: `task-${crypto.randomUUID()}`,
			title: String(data.get('title')).trim(),
			company: String(data.get('company')).trim(),
			dealId: String(data.get('dealId') ?? '') || null,
			owner: String(data.get('owner')),
			status: String(data.get('status')) as PreviewTask['status'],
			priority: String(data.get('priority')) as PreviewTask['priority'],
			due,
			overdue: false
		}
		task.overdue = isOverdue(task)
		setTasks(items =>
			editing === 'new'
				? [task, ...items]
				: items.map(item => (item.id === task.id ? task : item))
		)
		const savedDate = taskDate(task, today)
		if (editing === 'new') {
			setQuery('')
			setOwner('')
			setStatus(task.status === 'done' ? 'done' : 'active')
		}
		if (view === 'calendar' && savedDate !== null) {
			setWeekOffset(
				Math.floor((savedDate - currentWeekStart) / (7 * calendarDayMs))
			)
		}
		setEditing(null)
		setNotice('Задача сохранена')
	}
	const taskRow = (task: PreviewTask) => (
		<div
			key={task.id}
			className={styles.taskRow}
			data-done={task.status === 'done'}
		>
			<button
				className={styles.taskCheck}
				aria-label={`${task.status === 'done' ? 'Вернуть' : 'Выполнить'}: ${task.title}`}
				aria-pressed={task.status === 'done'}
				onClick={() => toggle(task)}
			>
				{task.status === 'done' && <AppIcon name="check" size={14} />}
			</button>
			<div className={styles.taskBody}>
				<button
					className={styles.recordLink}
					onClick={() => setEditing(task.id)}
				>
					{task.title}
				</button>
				<span>
					{task.company || 'Личная задача'}
					{task.priority === 'high' && (
						<PreviewStatus tone="warning">Приоритет</PreviewStatus>
					)}
				</span>
			</div>
			<span className={isOverdue(task) ? styles.overdue : styles.taskDue}>
				<AppIcon name="clock" size={13} />
				{task.due}
			</span>
			<span className={styles.avatar} title={task.owner}>
				{previewInitials(task.owner)}
			</span>
			{task.dealId && (
				<button
					className={styles.textButton}
					onClick={() => onOpenDeal(task.dealId!)}
				>
					К сделке ↗
				</button>
			)}
		</div>
	)
	return (
		<>
			<main className={styles.content}>
				<PreviewHeading
					eyebrow="МОЙ РАБОЧИЙ ДЕНЬ"
					title="Задачи"
					description="Договорённости, сроки и следующий шаг — в одном месте."
					action={
						<button
							className={styles.primaryButton}
							onClick={() => setEditing('new')}
						>
							<AppIcon name="plus" size={17} />
							Новая задача
						</button>
					}
				/>
				<div className={styles.contextStrip}>
					<span>
						<strong>
							{tasks.filter(item => item.status !== 'done').length}
						</strong>{' '}
						в работе
					</span>
					<span>
						<strong>
							{tasks.filter(item => item.status === 'done').length}
						</strong>{' '}
						выполнено
					</span>
					<span>
						{view === 'calendar'
							? 'Календарь по неделям'
							: 'Все задачи команды'}
					</span>
				</div>
				<div className={styles.viewBar}>
					<div className={styles.tabs}>
						{[
							['active', 'В работе'],
							['overdue', 'Просроченные'],
							['done', 'Выполненные'],
							['all', 'Все']
						].map(([value, label]) => (
							<button
								key={value}
								aria-pressed={status === value}
								className={status === value ? styles.activeTab : ''}
								onClick={() => setStatus(value)}
							>
								{label}
							</button>
						))}
					</div>
					<div className={styles.viewToggle}>
						<button
							aria-pressed={view === 'list'}
							onClick={() => setView('list')}
						>
							Список
						</button>
						<button
							aria-pressed={view === 'calendar'}
							onClick={() => setView('calendar')}
						>
							Календарь
						</button>
					</div>
				</div>
				<div className={styles.toolbar}>
					<PreviewSearch
						label="Поиск задач"
						value={query}
						onChange={setQuery}
						placeholder="Задача или компания"
					/>
					<label className={styles.selectWrap}>
						<select
							aria-label="Ответственный за задачу"
							value={owner}
							onChange={event => setOwner(event.target.value)}
						>
							<option value="">Все ответственные</option>
							{employees.map(person => (
								<option key={person.id}>{person.name}</option>
							))}
						</select>
						<AppIcon name="chevronDown" size={13} />
					</label>
					{(query || owner || status !== 'active') && (
						<button className={styles.textButton} onClick={reset}>
							Сбросить фильтры
						</button>
					)}
					<span className={styles.results}>
						{view === 'calendar'
							? `На неделе: ${weekTasks.length}`
							: `Задач: ${filtered.length}`}
					</span>
				</div>
				{view === 'list' ? (
					filtered.length === 0 ? (
						<PreviewEmpty reset={reset} />
					) : (
						<div className={styles.taskList}>{filtered.map(taskRow)}</div>
					)
				) : (
					<>
						<div className={styles.calendarToolbar}>
							<h2 aria-live="polite" aria-atomic="true">
								{weekLabel}
							</h2>
							<div
								className={styles.calendarNavigation}
								role="group"
								aria-label="Выбор недели"
							>
								<label className={styles.selectWrap}>
									К дате
									<input
										type="date"
										aria-label="Перейти к дате"
										min="0100-01-01"
										max="9999-12-24"
										value={new Date(Math.max(firstDate, weekStart))
											.toISOString()
											.slice(0, 10)}
										onInput={event => {
											const input = event.currentTarget
											if (!input.validity.valid || !input.value) return
											const date = Date.parse(`${input.value}T00:00:00Z`)
											if (Number.isFinite(date))
												setWeekOffset(
													Math.floor(
														(date - currentWeekStart) / (7 * calendarDayMs)
													)
												)
										}}
										onChange={() => {}}
									/>
								</label>
								<button
									className={styles.secondaryButton}
									onClick={() => setWeekOffset(0)}
								>
									Сегодня
								</button>
								<button
									className={styles.secondaryButton}
									aria-label="Предыдущая неделя"
									title="Предыдущая неделя"
									disabled={visibleWeekOffset <= firstWeekOffset}
									onClick={() => setWeekOffset(visibleWeekOffset - 1)}
								>
									<AppIcon
										name="chevronDown"
										size={16}
										className={styles.calendarPrevious}
									/>
								</button>
								<button
									className={styles.secondaryButton}
									aria-label="Следующая неделя"
									title="Следующая неделя"
									disabled={visibleWeekOffset >= lastWeekOffset}
									onClick={() => setWeekOffset(visibleWeekOffset + 1)}
								>
									<AppIcon
										name="chevronDown"
										size={16}
										className={styles.calendarNext}
									/>
								</button>
							</div>
						</div>
						<div
							className={styles.calendarGrid}
							role="region"
							aria-label={`Календарь задач: ${weekLabel}`}
							tabIndex={0}
						>
							{weekDates.map(date => {
								const dayTasks = weekTasks
									.filter(item => item.date === date)
									.sort((a, b) => taskTime(a.task) - taskTime(b.task))
								return (
									<section
										key={date}
										className={styles.calendarDay}
										data-today={date === today}
									>
										<header>
											<h3>
												<span>
													{days[(new Date(date).getUTCDay() + 6) % 7]}
												</span>
												<time
													dateTime={new Date(date)
														.toISOString()
														.slice(0, 10)}
													aria-current={
														date === today ? 'date' : undefined
													}
												>
													{calendarFormat(date, {
														day: 'numeric',
														month: 'short'
													})}
													{date === today && <small>Сегодня</small>}
												</time>
											</h3>
											<span aria-label={`Задач: ${dayTasks.length}`}>
												{dayTasks.length}
											</span>
										</header>
										{dayTasks.map(({ task }) => (
											<button
												key={task.id}
												className={styles.calendarTask}
												onClick={() => setEditing(task.id)}
												data-done={task.status === 'done'}
											>
												<span className={styles.taskDue}>{task.due}</span>
												<strong>{task.title}</strong>
												<small>{task.company}</small>
												<PreviewStatus
													tone={
														task.status === 'done' ? 'success' : 'purple'
													}
												>
													{taskStatuses[task.status]}
												</PreviewStatus>
											</button>
										))}
										{dayTasks.length === 0 && (
											<p className={styles.quietText}>Нет задач</p>
										)}
									</section>
								)
							})}
						</div>
						{unscheduledTasks.length > 0 && (
							<section className={styles.unscheduledTasks}>
								<h2>Без даты · {unscheduledTasks.length}</h2>
								<p className={styles.quietText}>
									Не привязаны к неделе. Откройте задачу и выберите дату и
									время.
								</p>
								{unscheduledTasks.map(({ task }) => taskRow(task))}
							</section>
						)}
					</>
				)}
				<p className={styles.notice} role="status">
					{notice}
				</p>
			</main>
			<Drawer
				isOpen={active && Boolean(editing)}
				onClose={() => setEditing(null)}
				title={editing === 'new' ? 'Новая задача' : 'Задача'}
				className={styles.previewDrawer}
			>
				{active && editing && (
					<PreviewForm className={styles.createForm} onSubmit={save}>
						<label>
							Что нужно сделать
							<input
								name="title"
								required
								pattern=".*\S.*"
								maxLength={160}
								defaultValue={editing === 'new' ? '' : editing.title}
							/>
						</label>
						<TaskRelationFields
							deals={deals}
							task={editing === 'new' ? null : editing}
						/>
						<label>
							Ответственный
							<select
								name="owner"
								defaultValue={
									editing === 'new' ? employees[0].name : editing.owner
								}
							>
								{employees.map(person => (
									<option key={person.id}>{person.name}</option>
								))}
							</select>
						</label>
						<div className={styles.formColumns}>
							<label>
								Статус
								<select
									name="status"
									defaultValue={
										editing === 'new' ? 'todo' : editing.status
									}
								>
									{Object.entries(taskStatuses).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</label>
							<label>
								Приоритет
								<select
									name="priority"
									defaultValue={
										editing === 'new' ? 'normal' : editing.priority
									}
								>
									<option value="normal">Обычный</option>
									<option value="high">Высокий</option>
								</select>
							</label>
						</div>
						<TaskDeadlineFields
							date={
								editing === 'new'
									? view === 'calendar' && weekOffset !== 0
										? Math.max(firstDate, weekStart)
										: today
									: taskDate(editing, today)
							}
							today={today}
							time={
								editing === 'new'
									? '16:00'
									: (editing.due.match(/(\d{2}:\d{2})$/)?.[1] ?? '16:00')
							}
						/>
						<p>
							Часовой пояс:{' '}
							{
								new Intl.DateTimeFormat('ru-RU', {
									timeZone: calendarPreferences.timeZone,
									timeZoneName: 'longOffset'
								})
									.formatToParts(new Date())
									.find(part => part.type === 'timeZoneName')?.value
							}
						</p>
						{editing !== 'new' && editing.dealId && (
							<PreviewDiscardButton
								className={styles.textButton}
								onClick={() => {
									const id = editing.dealId!
									setEditing(null)
									onOpenDeal(id)
								}}
							>
								Открыть связанную сделку ↗
							</PreviewDiscardButton>
						)}

						<div>
							<PreviewDiscardButton
								type="button"
								className={styles.secondaryButton}
								onClick={() => setEditing(null)}
							>
								Отмена
							</PreviewDiscardButton>
							<button className={styles.primaryButton}>
								Сохранить задачу
							</button>
						</div>
					</PreviewForm>
				)}
			</Drawer>
		</>
	)
}

export function PreviewContacts({
	active = true,
	contacts,
	setContacts,
	deals,
	onOpenDeal
}: {
	active?: boolean
	contacts: PreviewContact[]
	setContacts: Setter<PreviewContact>
	deals: PreviewDeal[]
	onOpenDeal: (id: string) => void
}) {
	const [query, setQuery] = useState('')
	const [segment, setSegment] = useState('')
	const [selected, setSelected] = useState<string | null>(null)
	const [editing, setEditing] = useState(false)
	const [notice, setNotice] = useState('')
	if (!active && editing) setEditing(false)
	if (!active && selected) setSelected(null)
	const contact = contacts.find(item => item.id === selected)
	const filtered = contacts.filter(
		item =>
			previewMatches(query, item.name, item.company, item.email) &&
			(!segment || item.segment === segment)
	)
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const data = new FormData(event.currentTarget)
		const record: PreviewContact = {
			id: contact?.id ?? `contact-${crypto.randomUUID()}`,
			name: String(data.get('name')).trim(),
			company: String(data.get('company')).trim(),
			email: String(data.get('email')).trim(),
			phone: String(data.get('phone')).trim(),
			role: String(data.get('role')).trim(),
			owner: contact?.owner ?? 'Анна Смирнова',
			segment: String(data.get('segment')) as PreviewContact['segment']
		}
		setContacts(items =>
			contact
				? items.map(item => (item.id === record.id ? record : item))
				: [record, ...items]
		)
		setSelected(record.id)
		setEditing(false)
		setNotice('Контакт сохранён в демоверсии')
	}
	return (
		<>
			<main className={styles.content}>
				<PreviewHeading
					eyebrow="КЛИЕНТСКАЯ БАЗА"
					title="Контакты"
					description="Люди и компании, с которыми вы строите отношения."
					action={
						<button
							className={styles.primaryButton}
							onClick={() => {
								setSelected(null)
								setEditing(true)
							}}
						>
							<AppIcon name="plus" size={17} />
							Новый контакт
						</button>
					}
				/>
				<div className={styles.viewBar}>
					<div className={styles.tabs}>
						{['', 'Клиент', 'Лид', 'Партнёр'].map(value => (
							<button
								key={value}
								className={segment === value ? styles.activeTab : ''}
								aria-pressed={segment === value}
								onClick={() => setSegment(value)}
							>
								{value || 'Все контакты'}
								<span>
									{
										contacts.filter(
											item => !value || item.segment === value
										).length
									}
								</span>
							</button>
						))}
					</div>
				</div>
				<div className={styles.toolbar}>
					<PreviewSearch
						label="Поиск контактов"
						value={query}
						onChange={setQuery}
						placeholder="Имя, компания или email"
					/>
					<span className={styles.results}>
						Контактов: {filtered.length}
					</span>
				</div>
				{!filtered.length ? (
					<PreviewEmpty
						reset={() => {
							setQuery('')
							setSegment('')
						}}
					/>
				) : (
					<div className={styles.resourceTableWrap}>
						<table className={styles.resourceTable}>
							<thead>
								<tr>
									<th>Контакт</th>
									<th>Компания</th>
									<th>Email</th>
									<th>Сегмент</th>
									<th>Ответственный</th>
								</tr>
							</thead>
							<tbody>
								{filtered.map(item => (
									<tr key={item.id}>
										<td>
											<button
												className={styles.personLink}
												onClick={() => {
													setSelected(item.id)
													setNotice('')
												}}
											>
												<span className={styles.personAvatar}>
													{previewInitials(item.name)}
												</span>
												<span>
													<strong>{item.name}</strong>
													<small>{item.role}</small>
												</span>
											</button>
										</td>
										<td data-label="Компания">{item.company}</td>
										<td data-label="Email">{item.email}</td>
										<td data-label="Сегмент">
											<PreviewStatus
												tone={
													item.segment === 'Клиент' ? 'success' : 'neutral'
												}
											>
												{item.segment}
											</PreviewStatus>
										</td>
										<td data-label="Ответственный">{item.owner}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</main>
			<Drawer
				isOpen={active && (Boolean(contact) || editing)}
				onClose={() => {
					setSelected(null)
					setEditing(false)
				}}
				title={
					editing
						? contact
							? 'Изменить контакт'
							: 'Новый контакт'
						: 'Контакт'
				}
				className={styles.previewDrawer}
			>
				{active && editing ? (
					<PreviewForm className={styles.createForm} onSubmit={save}>
						<label>
							Имя и фамилия
							<input
								name="name"
								required
								pattern=".*\S.*"
								defaultValue={contact?.name}
							/>
						</label>
						<label>
							Компания
							<input
								name="company"
								required
								pattern=".*\S.*"
								defaultValue={contact?.company}
							/>
						</label>
						<label>
							Должность
							<input name="role" defaultValue={contact?.role} />
						</label>
						<label>
							Email
							<input
								name="email"
								type="email"
								required
								defaultValue={contact?.email}
							/>
						</label>
						<label>
							Телефон
							<input
								name="phone"
								type="tel"
								defaultValue={contact?.phone}
							/>
						</label>
						<label>
							Сегмент
							<select
								name="segment"
								defaultValue={contact?.segment ?? 'Лид'}
							>
								{['Клиент', 'Лид', 'Партнёр'].map(value => (
									<option key={value}>{value}</option>
								))}
							</select>
						</label>
						<div>
							<PreviewDiscardButton
								type="button"
								className={styles.secondaryButton}
								onClick={() => {
									setEditing(false)
									if (!contact) setSelected(null)
								}}
							>
								Отмена
							</PreviewDiscardButton>
							<button className={styles.primaryButton}>
								Сохранить контакт
							</button>
						</div>
					</PreviewForm>
				) : (
					contact && (
						<div className={styles.detail}>
							<div className={styles.contactHero}>
								<span className={styles.largeAvatar}>
									{previewInitials(contact.name)}
								</span>
								<h2>{contact.name}</h2>
								<p>
									{[contact.role, contact.company]
										.filter(Boolean)
										.join(' · ')}
								</p>
								<PreviewStatus>{contact.segment}</PreviewStatus>
							</div>
							<section className={styles.detailInfo}>
								<dl>
									<div>
										<dt>Email</dt>
										<dd>{contact.email}</dd>
									</div>
									<div>
										<dt>Телефон</dt>
										<dd>{contact.phone || 'Не указан'}</dd>
									</div>
									<div>
										<dt>Ответственный</dt>
										<dd>{contact.owner}</dd>
									</div>
								</dl>
							</section>
							<section className={styles.detailInfo}>
								<h3>Связанные сделки</h3>
								{deals
									.filter(deal => deal.contactId === contact.id)
									.map(deal => (
										<button
											className={styles.relatedCard}
											key={deal.id}
											onClick={() => {
												setSelected(null)
												onOpenDeal(deal.id)
											}}
										>
											<span>
												{deal.title}
												<small>{deal.company}</small>
											</span>
											<strong>{previewMoney(deal.amount)} ↗</strong>
										</button>
									))}
								{deals.every(deal => deal.contactId !== contact.id) && (
									<p className={styles.quietText}>
										У контакта пока нет связанных сделок.
									</p>
								)}
							</section>
							<div className={styles.detailActions}>
								<button
									className={styles.secondaryButton}
									onClick={() => setEditing(true)}
								>
									Изменить контакт
								</button>
							</div>
							<p className={styles.notice} role="status">
								{notice}
							</p>
						</div>
					)
				)}
			</Drawer>
		</>
	)
}

export function PreviewCatalog({
	active = true,
	products,
	setProducts
}: {
	active?: boolean
	products: PreviewProduct[]
	setProducts: Setter<PreviewProduct>
}) {
	const [query, setQuery] = useState('')
	const [category, setCategory] = useState('')
	const [showArchive, setShowArchive] = useState(false)
	const [editing, setEditing] = useState<PreviewProduct | 'new' | null>(
		null
	)
	const [notice, setNotice] = useState('')
	if (!active && editing) setEditing(null)
	const filtered = products.filter(
		item =>
			previewMatches(query, item.title, item.category) &&
			(!category || item.category === category) &&
			item.active !== showArchive
	)
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const data = new FormData(event.currentTarget)
		const record: PreviewProduct = {
			id:
				editing && editing !== 'new'
					? editing.id
					: `product-${crypto.randomUUID()}`,
			title: String(data.get('title')).trim(),
			category: String(data.get('category')).trim(),
			unit: String(data.get('unit')).trim(),
			price: Number(data.get('price')),
			active: editing && editing !== 'new' ? editing.active : true
		}
		setProducts(items =>
			editing === 'new'
				? [record, ...items]
				: items.map(item => (item.id === record.id ? record : item))
		)
		if (editing === 'new') {
			setQuery('')
			setCategory('')
			setShowArchive(false)
		}
		setEditing(null)
		setNotice('Позиция сохранена')
	}
	return (
		<>
			<main className={styles.content}>
				<PreviewHeading
					eyebrow="ПРОДУКТЫ И УСЛУГИ"
					title="Каталог"
					description="Единые позиции и цены для ваших предложений."
					action={
						<button
							className={styles.primaryButton}
							onClick={() => setEditing('new')}
						>
							<AppIcon name="plus" size={17} />
							Добавить позицию
						</button>
					}
				/>
				<div className={styles.viewBar}>
					<div className={styles.tabs}>
						<button
							className={!showArchive ? styles.activeTab : ''}
							aria-pressed={!showArchive}
							onClick={() => setShowArchive(false)}
						>
							Действующие
							<span>{products.filter(item => item.active).length}</span>
						</button>
						<button
							className={showArchive ? styles.activeTab : ''}
							aria-pressed={showArchive}
							onClick={() => setShowArchive(true)}
						>
							Архив
							<span>{products.filter(item => !item.active).length}</span>
						</button>
					</div>
				</div>
				<div className={styles.toolbar}>
					<PreviewSearch
						value={query}
						onChange={setQuery}
						label="Поиск в каталоге"
						placeholder="Название продукта или услуги"
					/>
					<label className={styles.selectWrap}>
						<select
							value={category}
							aria-label="Категория"
							onChange={event => setCategory(event.target.value)}
						>
							<option value="">Все категории</option>
							{[...new Set(products.map(item => item.category))].map(
								value => (
									<option key={value}>{value}</option>
								)
							)}
						</select>
						<AppIcon name="chevronDown" size={13} />
					</label>
				</div>
				{!filtered.length ? (
					<PreviewEmpty
						title={
							showArchive ? 'В архиве пока пусто' : 'Позиции не найдены'
						}
						reset={() => {
							setQuery('')
							setCategory('')
							setShowArchive(false)
						}}
					/>
				) : (
					<div className={styles.resourceTableWrap}>
						<table className={styles.resourceTable}>
							<thead>
								<tr>
									<th>Наименование</th>
									<th>Категория</th>
									<th>Единица</th>
									<th>Цена</th>
									<th>Действие</th>
								</tr>
							</thead>
							<tbody>
								{filtered.map(item => (
									<tr key={item.id}>
										<td>
											<button
												className={styles.recordLink}
												onClick={() => setEditing(item)}
											>
												{item.title}
											</button>
										</td>
										<td data-label="Категория">{item.category}</td>
										<td data-label="Единица">{item.unit}</td>
										<td data-label="Цена" className={styles.amountCell}>
											{previewMoney(item.price)}
										</td>
										<td>
											<button
												className={styles.textButton}
												onClick={() => {
													setProducts(items =>
														items.map(product =>
															product.id === item.id
																? { ...product, active: !product.active }
																: product
														)
													)
													setNotice(
														item.active
															? 'Позиция перенесена в архив. Её можно восстановить.'
															: 'Позиция восстановлена'
													)
												}}
											>
												{item.active ? 'В архив' : 'Восстановить'}
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<p className={styles.notice} role="status">
					{notice}
				</p>
			</main>
			<Drawer
				isOpen={active && Boolean(editing)}
				onClose={() => setEditing(null)}
				title={
					editing === 'new' ? 'Новая позиция' : 'Редактировать позицию'
				}
				className={styles.previewDrawer}
			>
				{active && editing && (
					<PreviewForm className={styles.createForm} onSubmit={save}>
						<label>
							Наименование
							<input
								name="title"
								required
								pattern=".*\S.*"
								defaultValue={editing === 'new' ? '' : editing.title}
							/>
						</label>
						<label>
							Категория
							<input
								name="category"
								required
								pattern=".*\S.*"
								defaultValue={
									editing === 'new' ? 'Услуга' : editing.category
								}
							/>
						</label>
						<label>
							Единица измерения
							<input
								name="unit"
								required
								pattern=".*\S.*"
								defaultValue={editing === 'new' ? 'услуга' : editing.unit}
							/>
						</label>
						<label>
							Цена, ₽
							<input
								name="price"
								type="number"
								min="0"
								max="100000000000"
								step="0.01"
								required
								defaultValue={editing === 'new' ? '' : editing.price}
							/>
						</label>
						<div>
							<PreviewDiscardButton
								type="button"
								className={styles.secondaryButton}
								onClick={() => setEditing(null)}
							>
								Отмена
							</PreviewDiscardButton>
							<button className={styles.primaryButton}>
								Сохранить позицию
							</button>
						</div>
					</PreviewForm>
				)}
			</Drawer>
		</>
	)
}

export function PreviewDirectory({
	active = true,
	employees,
	onMessage
}: {
	active?: boolean
	employees: PreviewEmployee[]
	onMessage: (name: string) => void
}) {
	const [query, setQuery] = useState('')
	const [department, setDepartment] = useState('')
	const [selected, setSelected] = useState<PreviewEmployee | null>(null)
	const filtered = employees.filter(
		person =>
			previewMatches(query, person.name, person.email, person.role) &&
			(!department || person.department === department)
	)
	return (
		<>
			<main className={styles.content}>
				<PreviewHeading
					eyebrow="КОМАНДА"
					title="Сотрудники"
					description="Люди, с которыми вы работаете каждый день."
				/>
				<div className={styles.toolbar}>
					<PreviewSearch
						value={query}
						onChange={setQuery}
						label="Поиск сотрудников"
						placeholder="Имя, должность или email"
					/>
					<label className={styles.selectWrap}>
						<select
							aria-label="Отдел"
							value={department}
							onChange={event => setDepartment(event.target.value)}
						>
							<option value="">Все отделы</option>
							{[...new Set(employees.map(item => item.department))].map(
								value => (
									<option key={value}>{value}</option>
								)
							)}
						</select>
						<AppIcon name="chevronDown" size={13} />
					</label>
					<span className={styles.results}>
						Сотрудников: {filtered.length}
					</span>
				</div>
				{!filtered.length ? (
					<PreviewEmpty
						reset={() => {
							setQuery('')
							setDepartment('')
						}}
					/>
				) : (
					<div className={styles.peopleGrid}>
						{filtered.map(person => (
							<button
								key={person.id}
								className={styles.employeeCard}
								onClick={() => setSelected(person)}
							>
								<span className={styles.largeAvatar}>
									{person.initials}
									<i data-online={person.online} />
								</span>
								<strong>{person.name}</strong>
								<span>{person.role}</span>
								<PreviewStatus>{person.department}</PreviewStatus>
								<small>{person.email}</small>
								<span className={styles.employeeAction}>
									Открыть профиль ↗
								</span>
							</button>
						))}
					</div>
				)}
			</main>
			<Drawer
				isOpen={active && Boolean(selected)}
				onClose={() => setSelected(null)}
				title="Профиль сотрудника"
				className={styles.previewDrawer}
			>
				{selected && (
					<div className={styles.detail}>
						<div className={styles.contactHero}>
							<span className={styles.largeAvatar}>
								{selected.initials}
							</span>
							<h2>{selected.name}</h2>
							<p>{selected.role}</p>
							<PreviewStatus
								tone={selected.online ? 'success' : 'neutral'}
							>
								{selected.online ? 'В сети' : 'Не в сети'}
							</PreviewStatus>
						</div>
						<section className={styles.detailInfo}>
							<dl>
								<div>
									<dt>Отдел</dt>
									<dd>{selected.department}</dd>
								</div>
								<div>
									<dt>Рабочая почта</dt>
									<dd>{selected.email}</dd>
								</div>
							</dl>
						</section>
						<div className={styles.detailActions}>
							<button
								className={styles.primaryButton}
								onClick={() => {
									setSelected(null)
									onMessage(selected.name)
								}}
							>
								<AppIcon name="chat" size={17} />
								Написать сообщение
							</button>
						</div>
					</div>
				)}
			</Drawer>
		</>
	)
}
