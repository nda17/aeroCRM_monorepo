'use client'

import {
	useMemo,
	useState,
	useSyncExternalStore,
	type FormEvent
} from 'react'
import toast from 'react-hot-toast'
import {
	AssigneeSelect,
	assigneeDisplayName,
	useAssigneeLabels,
	useAssigneeOptions
} from '@/entities/crm-team'
import {
	parseReminderRule,
	sameReminderBinding,
	type ReminderBinding,
	type ReminderItem,
	type ReminderRule,
	type ReminderScope
} from '@/entities/crm-reminders'
import {
	browserWorkdayTimeZones,
	isIanaTimeZone,
	workdayTimeZoneGroups
} from '@/shared/lib/time-zones'
import { Button, SelectField, TextField } from '@/shared/ui'
import type { ReminderContext } from '../model/use-reminder-session'
import styles from './ReminderSettings.module.scss'

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false
export const ReminderRuleForm = ({
	scope,
	actor,
	initial,
	context,
	disabled,
	deliveryReady,
	onSave,
	onArchive,
	onClose
}: {
	scope: ReminderScope
	actor: ReminderBinding
	initial?: ReminderItem
	context: ReminderContext
	disabled: boolean
	deliveryReady: boolean
	onSave: (rule: ReminderRule) => void
	onArchive?: () => void
	onClose: () => void
}) => {
	const [rule, setRule] = useState<ReminderRule>(
		() =>
			initial?.rule ?? {
				schemaVersion: 1,
				id: crypto.randomUUID(),
				scope,
				ownerBinding: actor,
				title: '',
				enabled: false,
				channels: [],
				trigger: { kind: 'BEFORE_DUE', offsetMinutes: 60 },
				repeats: null,
				timeZone: '',
				quietHours: null,
				recipients: { kind: scope === 'PERSONAL' ? 'SELF' : 'ASSIGNEE' }
			}
	)
	const [attempted, setAttempted] = useState(false)
	const hydrated = useSyncExternalStore(
		subscribe,
		clientSnapshot,
		serverSnapshot
	)
	const zones = useMemo(
		() => (hydrated ? browserWorkdayTimeZones() : null),
		[hydrated]
	)
	const groups = useMemo(
		() => workdayTimeZoneGroups(rule.timeZone, zones),
		[rule.timeZone, zones]
	)
	const selected =
		rule.recipients.kind === 'SELECTED' ? rule.recipients.bindings : []
	const options = useAssigneeOptions({
		...context.directory,
		canRead:
			context.directory.canRead &&
			rule.recipients.kind === 'SELECTED' &&
			!disabled
	})
	const labels = useAssigneeLabels(
		{
			...context.directory,
			canRead: context.directory.canRead && selected.length > 0
		},
		selected
	)
	const change = (patch: Partial<ReminderRule>) => {
		if (!disabled && context.current())
			setRule(current => ({ ...current, ...patch }))
	}
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (disabled || !context.current()) return
		setAttempted(true)
		const parsed = parseReminderRule(rule)
		if (!parsed || (rule.enabled && !deliveryReady)) {
			toast.error('Проверьте настройки напоминания')
			return
		}
		onSave(structuredClone(parsed))
	}
	return (
		<form
			onSubmit={submit}
			className={styles.form}
			aria-label={
				initial ? 'Правило напоминания' : 'Новое правило напоминания'
			}
		>
			<h3>
				{initial ? 'Правило напоминания' : 'Новое правило напоминания'}
			</h3>
			<TextField
				label="Название правила"
				value={rule.title}
				maxLength={120}
				required
				readOnly={disabled}
				onChange={event => change({ title: event.target.value })}
			/>
			<label className={styles.check}>
				<input
					type="checkbox"
					checked={rule.enabled}
					disabled={disabled || (!deliveryReady && !rule.enabled)}
					onChange={event => {
						change({ enabled: event.target.checked })
						toast(
							event.target.checked
								? 'Отправка выбрана; сохраните правило'
								: 'Отключение выбрано; сохраните правило'
						)
					}}
				/>
				Включить отправку
			</label>
			{!deliveryReady ? (
				<p className={styles.notice}>
					Включение недоступно, пока сервер не подтвердит готовность
					доставки.
				</p>
			) : null}
			<fieldset disabled={disabled} className={styles.choices}>
				<legend>Каналы</legend>
				{(['EMAIL', 'TELEGRAM'] as const).map(channel => (
					<label key={channel} className={styles.check}>
						<input
							type="checkbox"
							checked={rule.channels.includes(channel)}
							onChange={event =>
								change({
									channels: event.target.checked
										? [...rule.channels, channel]
										: rule.channels.filter(value => value !== channel)
								})
							}
						/>
						{channel === 'EMAIL' ? 'Email' : 'Telegram'}
					</label>
				))}
			</fieldset>
			<div className={styles.fieldGrid}>
				<SelectField
					label="Когда напоминать"
					value={rule.trigger.kind}
					disabled={disabled}
					onChange={event => {
						const kind = event.target
							.value as ReminderRule['trigger']['kind']
						if (
							['BEFORE_DUE', 'AT_DUE', 'AFTER_DUE', 'ASSIGNED'].includes(
								kind
							)
						)
							change({
								trigger: {
									kind,
									offsetMinutes:
										kind === 'AT_DUE' || kind === 'ASSIGNED'
											? 0
											: rule.trigger.offsetMinutes || 60
								},
								...(kind === 'ASSIGNED' ? { repeats: null } : {})
							})
					}}
				>
					<option value="BEFORE_DUE">До срока</option>
					<option value="AT_DUE">В момент срока</option>
					<option value="AFTER_DUE">После просрочки</option>
					<option value="ASSIGNED">При назначении задачи</option>
				</SelectField>
				{rule.trigger.kind !== 'AT_DUE' &&
				rule.trigger.kind !== 'ASSIGNED' ? (
					<TextField
						label="Отступ, минут"
						type="number"
						min={1}
						max={43200}
						step={1}
						required
						value={rule.trigger.offsetMinutes}
						readOnly={disabled}
						onChange={event =>
							change({
								trigger: {
									...rule.trigger,
									offsetMinutes: event.target.valueAsNumber
								}
							})
						}
					/>
				) : null}
			</div>
			{rule.trigger.kind === 'ASSIGNED' ? (
				<p className={styles.notice}>
					Одно уведомление при создании задачи или смене ответственного
					после сохранения правила. Старые назначения не рассылаются.
					Изменение текста или срока не вызывает повторную отправку. Тихие
					часы учитываются.
				</p>
			) : (
				<label className={styles.check}>
					<input
						type="checkbox"
						checked={rule.repeats !== null}
						disabled={disabled}
						onChange={event =>
							change({
								repeats: event.target.checked
									? { intervalMinutes: 60, count: 2 }
									: null
							})
						}
					/>
					Повторять напоминание
				</label>
			)}
			{rule.repeats ? (
				<div className={styles.fieldGrid}>
					<TextField
						label="Интервал повтора, минут"
						type="number"
						min={15}
						max={43200}
						step={1}
						required
						value={rule.repeats.intervalMinutes}
						readOnly={disabled}
						onChange={event =>
							change({
								repeats: {
									...rule.repeats!,
									intervalMinutes: event.target.valueAsNumber
								}
							})
						}
					/>
					<TextField
						label="Всего отправок, включая первую"
						type="number"
						min={2}
						max={1000}
						step={1}
						required
						value={rule.repeats.count}
						readOnly={disabled}
						onChange={event =>
							change({
								repeats: {
									...rule.repeats!,
									count: event.target.valueAsNumber
								}
							})
						}
					/>
				</div>
			) : null}
			<SelectField
				label="Часовой пояс напоминания"
				value={rule.timeZone}
				required
				disabled={disabled}
				onChange={event => {
					if (isIanaTimeZone(event.target.value))
						change({ timeZone: event.target.value })
				}}
			>
				<option value="" disabled>
					Выберите часовой пояс
				</option>
				{groups.map(group => (
					<optgroup key={group.label} label={group.label}>
						{group.options.map(option => (
							<option
								key={option.value}
								value={option.value}
								disabled={option.disabled}
							>
								{option.label}
							</option>
						))}
					</optgroup>
				))}
			</SelectField>
			<label className={styles.check}>
				<input
					type="checkbox"
					checked={rule.quietHours !== null}
					disabled={disabled}
					onChange={event =>
						change({
							quietHours: event.target.checked
								? { start: '', end: '' }
								: null
						})
					}
				/>
				Тихие часы
			</label>
			{rule.quietHours ? (
				<div className={styles.fieldGrid}>
					<TextField
						label="Не отправлять с"
						type="time"
						value={rule.quietHours.start}
						required
						readOnly={disabled}
						onChange={event =>
							change({
								quietHours: {
									...rule.quietHours!,
									start: event.target.value
								}
							})
						}
					/>
					<TextField
						label="Не отправлять до"
						type="time"
						value={rule.quietHours.end}
						required
						readOnly={disabled}
						onChange={event =>
							change({
								quietHours: {
									...rule.quietHours!,
									end: event.target.value
								}
							})
						}
					/>
				</div>
			) : null}
			{scope === 'PERSONAL' ? (
				<p className={styles.notice}>
					Получатель — только вы, для задач, назначенных на ваш текущий
					доступ сотрудника.
				</p>
			) : (
				<SelectField
					label="Получатели"
					value={rule.recipients.kind}
					disabled={disabled}
					onChange={event => {
						const kind = event.target.value
						if (kind === 'SELECTED')
							change({ recipients: { kind, bindings: [] } })
						else if (
							kind === 'ASSIGNEE' ||
							kind === 'TEAM_LEADS' ||
							kind === 'WORKSPACE'
						)
							change({ recipients: { kind } })
					}}
				>
					<option value="ASSIGNEE">Ответственный</option>
					<option value="TEAM_LEADS">Руководители отдела</option>
					<option value="SELECTED">Выбранные сотрудники</option>
					<option value="WORKSPACE">Вся команда</option>
				</SelectField>
			)}
			{rule.recipients.kind === 'SELECTED' ? (
				<div className={styles.content}>
					<AssigneeSelect
						options={options}
						value={null}
						disabled={disabled || selected.length >= 100}
						label="Добавить получателя"
						onChange={option => {
							const binding = {
								subject: option.subject,
								membershipId:
									option.role === 'OWNER' ? null : option.membershipId
							}
							if (
								selected.some(item => sameReminderBinding(item, binding))
							) {
								toast('Этот сотрудник уже выбран')
								return
							}
							change({
								recipients: {
									kind: 'SELECTED',
									bindings: [...selected, binding]
								}
							})
							toast('Получатель добавлен в правило')
						}}
					/>
					<p className={styles.notice}>
						Выбрано: {selected.length} / 100. Сотрудники получают только
						доступные им задачи.
					</p>
					{labels.error ? (
						<p role="alert" className={styles.error}>
							Не удалось загрузить имена. Привязки получателей сохранены.
						</p>
					) : null}
					<ul className={styles.rules}>
						{selected.map((binding, index) => {
							const employee = labels.lookup(binding)?.employee
							return (
								<li key={JSON.stringify(binding)}>
									<span>
										{employee
											? assigneeDisplayName(employee)
											: `Выбранный сотрудник ${index + 1} — имя недоступно`}
									</span>
									<Button
										variant="secondary"
										disabled={disabled}
										onClick={() => {
											change({
												recipients: {
													kind: 'SELECTED',
													bindings: selected.filter(
														item => !sameReminderBinding(item, binding)
													)
												}
											})
											toast('Получатель удалён из правила')
										}}
									>
										Убрать получателя {index + 1}
									</Button>
								</li>
							)
						})}
					</ul>
				</div>
			) : null}
			<p className={styles.notice}>
				Изменения применяются только после сохранения. Отправка не
				выполняется из этой формы.
			</p>
			{attempted && !parseReminderRule(rule) ? (
				<p role="alert" className={styles.error}>
					Проверьте название, каналы, диапазоны чисел, часовой пояс, разные
					границы тихих часов и получателей.
				</p>
			) : null}
			<div className={styles.actions}>
				<Button
					type="submit"
					disabled={disabled || (rule.enabled && !deliveryReady)}
				>
					Сохранить правило
				</Button>
				{onArchive ? (
					<Button variant="danger" disabled={disabled} onClick={onArchive}>
						Архивировать правило
					</Button>
				) : null}
				<Button variant="secondary" onClick={onClose}>
					Закрыть правило
				</Button>
			</div>
		</form>
	)
}
