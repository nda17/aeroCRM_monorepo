'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import type { PreviewEmployee } from '../model/workspace-data'
import {
	PreviewHeading,
	PreviewSearch,
	PreviewStatus
} from './PreviewPrimitives'
import styles from './DesignPreview.module.scss'

type Tab =
	| 'general'
	| 'notifications'
	| 'team'
	| 'sources'
	| 'mail'
	| 'subscription'
type Theme = 'light' | 'dark'
type NotificationKey = 'tasks' | 'inbox' | 'messages' | 'mail' | 'digest'
type Notifications = Record<NotificationKey, boolean>

const tabs: { value: Tab; label: string }[] = [
	{ value: 'general', label: 'Общее' },
	{ value: 'notifications', label: 'Уведомления' },
	{ value: 'team', label: 'Команда' },
	{ value: 'sources', label: 'Источники' },
	{ value: 'mail', label: 'Почта' },
	{ value: 'subscription', label: 'Подписка' }
]
const timeZones = [
	{ value: 'Europe/Kaliningrad', label: 'Калининград · UTC+2' },
	{ value: 'Europe/Moscow', label: 'Москва · UTC+3' },
	{ value: 'Asia/Yekaterinburg', label: 'Екатеринбург · UTC+5' },
	{ value: 'Asia/Novosibirsk', label: 'Новосибирск · UTC+7' },
	{ value: 'Asia/Vladivostok', label: 'Владивосток · UTC+10' }
]
const notificationOptions: {
	key: NotificationKey
	label: string
	description: string
}[] = [
	{
		key: 'tasks',
		label: 'Напоминания о задачах',
		description: 'Когда приближается срок следующего действия.'
	},
	{
		key: 'inbox',
		label: 'Новые обращения',
		description: 'Когда в очередь поступает новая заявка клиента.'
	},
	{
		key: 'messages',
		label: 'Сообщения команды',
		description: 'Новые сообщения в личных диалогах и общем чате.'
	},
	{
		key: 'mail',
		label: 'Входящие письма',
		description: 'Письма в доступных вам рабочих ящиках.'
	},
	{
		key: 'digest',
		label: 'Обзор рабочего дня',
		description: 'Краткий список предстоящих и просроченных задач.'
	}
]
const initialNotifications: Notifications = {
	tasks: true,
	inbox: true,
	messages: true,
	mail: true,
	digest: false
}
const roles = [
	{
		name: 'Владелец',
		description: 'Управляет пространством, подпиской и доступом команды.'
	},
	{
		name: 'Администратор CRM',
		description: 'Настраивает CRM и команду в пределах прав владельца.'
	},
	{
		name: 'Руководитель',
		description: 'Работает со своими отделами и распределяет задачи.'
	},
	{
		name: 'Менеджер',
		description: 'Ведёт доступных клиентов, обращения, сделки и задачи.'
	},
	{
		name: 'Аналитик',
		description:
			'Просматривает агрегированные показатели без персональных данных.'
	}
]

export default function PreviewSettings({
	workspaceName,
	onWorkspaceNameChange,
	employees,
	theme,
	onThemeChange
}: {
	workspaceName: string
	onWorkspaceNameChange: (name: string) => void
	employees: PreviewEmployee[]
	theme: Theme
	onThemeChange: (theme: Theme) => void
}) {
	const [tab, setTab] = useState<Tab>('general')
	const [general, setGeneral] = useState({
		name: workspaceName,
		timeZone: 'Europe/Moscow',
		weekStart: 'monday'
	})
	const [savedGeneral, setSavedGeneral] = useState(general)
	const [notifications, setNotifications] = useState(initialNotifications)
	const [savedNotifications, setSavedNotifications] = useState(
		initialNotifications
	)
	const [teamSearch, setTeamSearch] = useState('')
	const [sourceName, setSourceName] = useState('')
	const [sourceType, setSourceType] = useState('Форма сайта')
	const [sourceSla, setSourceSla] = useState('30')
	const [sources, setSources] = useState<
		{
			id: string
			name: string
			type: string
			sla: number
			enabled: boolean
		}[]
	>([])
	const [mail, setMail] = useState({
		address: '',
		name: '',
		access: 'shared'
	})
	const [savedMail, setSavedMail] = useState<typeof mail | null>(null)
	const [notice, setNotice] = useState('')
	const [error, setError] = useState('')
	const generalDirty =
		JSON.stringify(general) !== JSON.stringify(savedGeneral)
	const notificationsDirty = notificationOptions.some(
		option => notifications[option.key] !== savedNotifications[option.key]
	)
	const enabledNotifications = notificationOptions.filter(
		option => savedNotifications[option.key]
	).length
	const departments = [
		...new Set(employees.map(employee => employee.department))
	]
	const visibleEmployees = employees.filter(employee =>
		`${employee.name} ${employee.role} ${employee.department} ${employee.email}`
			.toLocaleLowerCase('ru')
			.includes(teamSearch.trim().toLocaleLowerCase('ru'))
	)
	const changeTab = (value: Tab) => {
		setTab(value)
		setNotice('')
		setError('')
	}
	const saveGeneral = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const name = general.name.trim()
		if (!name) {
			setError('Введите название пространства — хотя бы один символ.')
			return
		}
		const next = { ...general, name }
		setGeneral(next)
		setSavedGeneral(next)
		onWorkspaceNameChange(name)
		setError('')
		setNotice('Настройки пространства сохранены в предпросмотре.')
	}
	const saveNotifications = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setSavedNotifications({ ...notifications })
		setNotice('Предпочтения уведомлений сохранены в предпросмотре.')
	}
	const addSource = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const name = sourceName.trim()
		const sla = Number(sourceSla)
		if (!name) {
			setError('Введите название источника — хотя бы один символ.')
			return
		}
		if (!Number.isInteger(sla) || sla < 1 || sla > 1440) {
			setError('Укажите время реакции от 1 до 1440 минут.')
			return
		}
		if (
			sources.some(
				source =>
					source.name.toLocaleLowerCase('ru') ===
					name.toLocaleLowerCase('ru')
			)
		) {
			setError('Источник с таким названием уже добавлен.')
			return
		}
		setSources(items => [
			...items,
			{
				id: `source-${Date.now()}`,
				name,
				type: sourceType,
				sla,
				enabled: true
			}
		])
		setSourceName('')
		setError('')
		setNotice(`Источник «${name}» добавлен в предпросмотр.`)
	}
	const saveMail = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const name = mail.name.trim()
		const address = mail.address.trim()
		if (!name || !address) {
			setError(
				'Укажите адрес и имя отправителя. Поля не могут состоять из пробелов.'
			)
			return
		}
		const next = { ...mail, name, address }
		setMail(next)
		setSavedMail(next)
		setError('')
		setNotice('Настройки демонстрационного ящика сохранены.')
	}
	const feedback = (
		<>
			{error && (
				<p
					id="preview-settings-error"
					className={styles.overdue}
					role="alert"
				>
					{error}
				</p>
			)}
			{notice && (
				<p className={styles.notice} role="status">
					{notice}
				</p>
			)}
		</>
	)

	return (
		<>
			<PreviewHeading
				eyebrow="РАБОЧЕЕ ПРОСТРАНСТВО"
				title="Настройки"
				description="Команда, оформление и привычный порядок работы"
				action={
					<PreviewStatus tone="purple">
						Локальный предпросмотр
					</PreviewStatus>
				}
			/>
			<div className={styles.settingsLayout}>
				<nav className={styles.settingsNav} aria-label="Разделы настроек">
					{tabs.map(item => (
						<button
							key={item.value}
							aria-current={tab === item.value ? 'page' : undefined}
							onClick={() => changeTab(item.value)}
						>
							{item.label}
						</button>
					))}
				</nav>
				<div className={styles.settingsPanel}>
					{tab === 'general' && (
						<>
							<section
								className={styles.settingsSection}
								aria-labelledby="preview-general-title"
							>
								<h2 id="preview-general-title">Ваше пространство</h2>
								<p>
									Название объединяет команду и помогает узнавать нужное
									пространство.
								</p>
								<form className={styles.createForm} onSubmit={saveGeneral}>
									<label>
										Название пространства
										<input
											value={general.name}
											onChange={event => {
												setGeneral(value => ({
													...value,
													name: event.target.value
												}))
												setError('')
												setNotice('')
											}}
											maxLength={80}
											required
											aria-invalid={Boolean(error)}
											aria-describedby={
												error ? 'preview-settings-error' : undefined
											}
										/>
									</label>
									<label>
										Часовой пояс
										<select
											value={general.timeZone}
											onChange={event => {
												setGeneral(value => ({
													...value,
													timeZone: event.target.value
												}))
												setNotice('')
											}}
										>
											{timeZones.map(zone => (
												<option key={zone.value} value={zone.value}>
													{zone.label}
												</option>
											))}
										</select>
									</label>
									<label>
										Первый день недели
										<select
											value={general.weekStart}
											onChange={event => {
												setGeneral(value => ({
													...value,
													weekStart: event.target.value
												}))
												setNotice('')
											}}
										>
											<option value="monday">Понедельник</option>
											<option value="sunday">Воскресенье</option>
										</select>
									</label>
									{feedback}
									<div className={styles.settingsFoot}>
										<PreviewStatus
											tone={generalDirty ? 'warning' : 'success'}
										>
											{generalDirty
												? 'Есть изменения'
												: 'Все изменения сохранены'}
										</PreviewStatus>
										{generalDirty && (
											<button
												type="button"
												className={styles.secondaryButton}
												onClick={() => {
													setGeneral(savedGeneral)
													setError('')
													setNotice('Изменения отменены.')
												}}
											>
												Отменить
											</button>
										)}
										<button type="submit" className={styles.primaryButton}>
											Сохранить настройки
										</button>
									</div>
								</form>
								<p className={styles.analyticsNote}>
									Сохранено:{' '}
									{
										timeZones.find(
											zone => zone.value === savedGeneral.timeZone
										)?.label
									}{' '}
									· неделя с{' '}
									{savedGeneral.weekStart === 'monday'
										? 'понедельника'
										: 'воскресенья'}
									.
								</p>
							</section>
							<section
								className={styles.settingsSection}
								aria-labelledby="preview-theme-title"
							>
								<div className={styles.settingsRow}>
									<div>
										<h2 id="preview-theme-title">Оформление</h2>
										<p>
											Выбор темы применяется сразу ко всему предпросмотру.
										</p>
									</div>
									<div
										className={styles.viewToggle}
										aria-label="Цветовая тема"
									>
										<button
											aria-pressed={theme === 'light'}
											onClick={() => onThemeChange('light')}
										>
											<AppIcon name="sun" size={16} />
											Светлая
										</button>
										<button
											aria-pressed={theme === 'dark'}
											onClick={() => onThemeChange('dark')}
										>
											<AppIcon name="moon" size={16} />
											Тёмная
										</button>
									</div>
								</div>
							</section>
						</>
					)}
					{tab === 'notifications' && (
						<section
							className={styles.settingsSection}
							aria-labelledby="preview-notifications-title"
						>
							<h2 id="preview-notifications-title">
								Держите важное в поле зрения
							</h2>
							<p>Выберите события для своего центра уведомлений.</p>
							<form onSubmit={saveNotifications}>
								{notificationOptions.map(option => (
									<label className={styles.settingsRow} key={option.key}>
										<span>
											<strong>{option.label}</strong>
											<small>{option.description}</small>
										</span>
										<input
											type="checkbox"
											role="switch"
											className={styles.toggle}
											checked={notifications[option.key]}
											aria-label={option.label}
											onChange={event => {
												setNotifications(value => ({
													...value,
													[option.key]: event.target.checked
												}))
												setNotice('')
											}}
										/>
									</label>
								))}
								{feedback}
								<div className={styles.settingsFoot}>
									<PreviewStatus
										tone={notificationsDirty ? 'warning' : 'success'}
									>
										{notificationsDirty
											? 'Есть изменения'
											: `Включено событий: ${enabledNotifications} из ${notificationOptions.length}`}
									</PreviewStatus>
									{notificationsDirty && (
										<button
											type="button"
											className={styles.secondaryButton}
											onClick={() => {
												setNotifications(savedNotifications)
												setNotice('Изменения отменены.')
											}}
										>
											Отменить
										</button>
									)}
									<button type="submit" className={styles.primaryButton}>
										Сохранить уведомления
									</button>
								</div>
							</form>
						</section>
					)}
					{tab === 'team' && (
						<>
							<section
								className={styles.settingsSection}
								aria-labelledby="preview-settings-team-title"
							>
								<div className={styles.settingsRow}>
									<div>
										<h2 id="preview-settings-team-title">
											Команда пространства
										</h2>
										<p>
											Сотрудников: {employees.length} · отделов:{' '}
											{departments.length}
										</p>
									</div>
									<PreviewStatus tone="purple">
										Демонстрационная команда
									</PreviewStatus>
								</div>
								<div className={styles.toolbar}>
									<PreviewSearch
										value={teamSearch}
										onChange={setTeamSearch}
										label="Найти сотрудника в настройках"
										placeholder="Имя, должность или отдел"
									/>
								</div>
								<div className={styles.tableScroll}>
									<table className={styles.table}>
										<caption className={styles.srOnly}>
											Состав команды пространства
										</caption>
										<thead>
											<tr>
												<th scope="col">Сотрудник</th>
												<th scope="col">Должность</th>
												<th scope="col">Отдел</th>
											</tr>
										</thead>
										<tbody>
											{visibleEmployees.map(employee => (
												<tr key={employee.id}>
													<td>
														<span className={styles.tableOwner}>
															<span className={styles.avatar}>
																{employee.initials}
															</span>
															{employee.name}
														</span>
													</td>
													<td>{employee.role}</td>
													<td>{employee.department}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
								{!visibleEmployees.length && (
									<p className={styles.analyticsNote}>
										Сотрудники не найдены. Измените запрос.
									</p>
								)}
							</section>
							<section
								className={styles.settingsSection}
								aria-labelledby="preview-roles-title"
							>
								<h2 id="preview-roles-title">Роли доступа</h2>
								<p>
									Роль определяет действия, отдел — область доступных
									записей.
								</p>
								{roles.map(role => (
									<div className={styles.settingsRow} key={role.name}>
										<div>
											<strong>{role.name}</strong>
											<p>{role.description}</p>
										</div>
										<AppIcon name="lock" size={17} />
									</div>
								))}
							</section>
						</>
					)}
					{tab === 'sources' && (
						<>
							<section
								className={styles.settingsSection}
								aria-labelledby="preview-sources-title"
							>
								<h2 id="preview-sources-title">Источники обращений</h2>
								<p>
									Подготовьте каналы и время реакции. Настройки сохраняются
									в предпросмотре.
								</p>
								{sources.length ? (
									sources.map(source => (
										<div className={styles.settingsRow} key={source.id}>
											<div>
												<strong>{source.name}</strong>
												<p>
													{source.type} · реакция в течение {source.sla}{' '}
													мин
												</p>
												<PreviewStatus
													tone={source.enabled ? 'success' : 'neutral'}
												>
													{source.enabled
														? 'Включён в превью'
														: 'Отключён'}
												</PreviewStatus>
											</div>
											<input
												className={styles.toggle}
												type="checkbox"
												role="switch"
												aria-label={`Включить источник ${source.name}`}
												checked={source.enabled}
												onChange={event => {
													setSources(items =>
														items.map(item =>
															item.id === source.id
																? {
																		...item,
																		enabled: event.target.checked
																	}
																: item
														)
													)
													setNotice(
														'Состояние источника сохранено в предпросмотре.'
													)
												}}
											/>
										</div>
									))
								) : (
									<div className={styles.planCard}>
										<AppIcon name="inbox" size={22} />
										<strong>Добавьте первый источник</strong>
										<p>
											Задайте имя и тип канала в форме ниже. Подключение к
											внешнему сервису выполняется отдельно.
										</p>
									</div>
								)}
							</section>
							<section
								className={styles.settingsSection}
								aria-labelledby="preview-new-source-title"
							>
								<h2 id="preview-new-source-title">Новый источник</h2>
								<form className={styles.createForm} onSubmit={addSource}>
									<label>
										Название
										<input
											value={sourceName}
											required
											maxLength={80}
											placeholder="Например, заявка с главной страницы"
											onChange={event => {
												setSourceName(event.target.value)
												setError('')
												setNotice('')
											}}
											aria-invalid={Boolean(error)}
											aria-describedby={
												error ? 'preview-settings-error' : undefined
											}
										/>
									</label>
									<label>
										Тип канала
										<select
											value={sourceType}
											onChange={event => setSourceType(event.target.value)}
										>
											<option>Форма сайта</option>
											<option>Tilda</option>
											<option>Внешний API</option>
											<option>Ручной ввод</option>
										</select>
									</label>
									<label>
										Время реакции, минут
										<input
											type="number"
											value={sourceSla}
											min={1}
											max={1440}
											step={1}
											required
											onChange={event => {
												setSourceSla(event.target.value)
												setError('')
											}}
										/>
									</label>
									{feedback}
									<div className={styles.settingsFoot}>
										<button className={styles.primaryButton} type="submit">
											<AppIcon name="plus" size={16} />
											Добавить в предпросмотр
										</button>
									</div>
								</form>
							</section>
						</>
					)}
					{tab === 'mail' && (
						<section
							className={styles.settingsSection}
							aria-labelledby="preview-mail-settings-title"
						>
							<h2 id="preview-mail-settings-title">Рабочая почта</h2>
							<p>
								Настройте отображение ящика и доступ к нему в
								демонстрационном пространстве.
							</p>
							{savedMail && (
								<div className={styles.planCard}>
									<AppIcon name="mail" size={22} />
									<strong>{savedMail.address}</strong>
									<p>
										{savedMail.name} ·{' '}
										{savedMail.access === 'shared'
											? 'Общий ящик команды'
											: 'Личный ящик'}
									</p>
									<PreviewStatus tone="purple">
										Демонстрационный ящик
									</PreviewStatus>
								</div>
							)}
							<form className={styles.createForm} onSubmit={saveMail}>
								<label>
									Адрес ящика
									<input
										type="email"
										autoComplete="off"
										required
										maxLength={200}
										value={mail.address}
										placeholder="team@example.com"
										onChange={event => {
											setMail(value => ({
												...value,
												address: event.target.value
											}))
											setError('')
											setNotice('')
										}}
									/>
								</label>
								<label>
									Имя отправителя
									<input
										required
										maxLength={80}
										value={mail.name}
										placeholder={workspaceName}
										onChange={event => {
											setMail(value => ({
												...value,
												name: event.target.value
											}))
											setError('')
											setNotice('')
										}}
										aria-invalid={Boolean(error)}
										aria-describedby={
											error ? 'preview-settings-error' : undefined
										}
									/>
								</label>
								<label>
									Доступ к ящику
									<select
										value={mail.access}
										onChange={event => {
											setMail(value => ({
												...value,
												access: event.target.value
											}))
											setNotice('')
										}}
									>
										<option value="shared">
											Общий · доступ для команды
										</option>
										<option value="personal">
											Личный · только для меня
										</option>
									</select>
								</label>
								<p>
									Подключение к почтовому сервису и отправка писем доступны
									в рабочей CRM. Здесь вы настраиваете демонстрационную
									карточку ящика.
								</p>
								{feedback}
								<div className={styles.settingsFoot}>
									{savedMail && (
										<button
											type="button"
											className={styles.secondaryButton}
											onClick={() => {
												setMail(savedMail)
												setError('')
												setNotice('Сохранённые настройки восстановлены.')
											}}
										>
											Вернуть сохранённое
										</button>
									)}
									<button type="submit" className={styles.primaryButton}>
										Сохранить ящик в превью
									</button>
								</div>
							</form>
						</section>
					)}
					{tab === 'subscription' && (
						<section
							className={styles.settingsSection}
							aria-labelledby="preview-subscription-title"
						>
							<h2 id="preview-subscription-title">
								Пространство для всей команды
							</h2>
							<p>
								Состав команды и возможности демонстрационного
								пространства.
							</p>
							<div className={styles.planCard}>
								<PreviewStatus tone="purple">
									Демонстрационный режим
								</PreviewStatus>
								<h3>{workspaceName}</h3>
								<div className={styles.planPrice}>
									<span>Участников: </span>
									{employees.length}
								</div>
								<p>
									В предпросмотре открыты все разделы CRM. Выбор тарифа и
									оформление подписки выполняются в рабочем пространстве.
								</p>
								{[
									'Сделки, задачи и планирование',
									'Контакты, компании и каталог',
									'Входящие, почта и командные сообщения',
									'Аналитика и настройки пространства'
								].map(feature => (
									<div className={styles.settingsRow} key={feature}>
										<AppIcon name="check" size={17} />
										<span>{feature}</span>
									</div>
								))}
								<button
									className={styles.secondaryButton}
									onClick={() => changeTab('team')}
								>
									<AppIcon name="user" size={17} />
									Посмотреть состав команды
								</button>
							</div>
						</section>
					)}
				</div>
			</div>
		</>
	)
}
