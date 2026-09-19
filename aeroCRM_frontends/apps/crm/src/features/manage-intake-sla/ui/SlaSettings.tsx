'use client'

import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
	crmPermissionScope,
	getCrmPermissions
} from '@/entities/crm-access'
import { AssigneeSelect, useAssigneeOptions } from '@/entities/crm-team'
import {
	getSlaRule,
	parseSlaConfig,
	saveSlaRule,
	type SlaCommand,
	type SlaConfig,
	type SlaRuleResponse
} from '@/entities/intake-sla'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import {
	Button,
	ReadOnlyBanner,
	ScreenState,
	StatusBadge,
	TextField,
	TimeZoneSelect
} from '@/shared/ui'
import { useSlaSession, type SlaContext } from '../model/use-sla-session'
import styles from './SlaSettings.module.scss'

const initialConfig: SlaConfig = {
	enabled: false,
	workingMinutes: 30,
	timeZone: 'Europe/Moscow',
	weekdays: [1, 2, 3, 4, 5],
	workStart: '09:00',
	workEnd: '18:00',
	responsibleBinding: null,
	notifyManagers: false,
	channels: ['EMAIL']
}
const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const SlaForm = ({
	context,
	response,
	onSaved
}: {
	context: SlaContext
	response: SlaRuleResponse
	onSaved: () => void
}) => {
	const [config, setConfig] = useState<SlaConfig>(() =>
		structuredClone(response.rule?.config ?? initialConfig)
	)
	const options = useAssigneeOptions(context.directory, {
		selectedSubject: config.responsibleBinding?.subject
	})
	// Only the directory's current OWNER may resolve the contract's null owner binding.
	const binding = config.responsibleBinding
	const selected =
		binding?.membershipId === null
			? options.selected?.subject === binding.subject &&
				options.selected.role === 'OWNER'
				? options.selected
				: null
			: binding
				? options.resolveBinding(binding)
				: null
	const command = useMemoryCommand<SlaCommand, SlaRuleResponse>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: context.key
		},
		'intake-sla-rule',
		context.canWrite,
		async () => {
			if (!context.current() || !context.session || !navigator.onLine)
				throw new AuthenticatedApiError(
					'temporary',
					'Нет действующего доступа или подключения к сети.'
				)
			const fresh = await getCrmPermissions(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			if (
				!context.current() ||
				fresh.workspaceId !== context.workspace.workspaceId ||
				fresh.subject !== context.session.userId ||
				crmPermissionScope(fresh) !== context.scopeKey ||
				!['OWNER', 'CRM_ADMIN'].includes(fresh.role) ||
				!['ACTIVE', 'GRACE'].includes(fresh.state) ||
				!fresh.permissions.includes('intake:write') ||
				!context.workspace.canWrite
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Права изменились. Обновите настройки SLA.'
				)
			return context.session.accessToken
		},
		saveSlaRule,
		() => {
			toast.success('Настройки SLA сохранены')
			onSaved()
		}
	)
	const disabled = !context.canWrite || command.locked
	const set = <K extends keyof SlaConfig>(key: K, value: SlaConfig[K]) =>
		setConfig(previous => ({ ...previous, [key]: value }))
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (disabled || !context.current()) return
		if (!config.channels.length) {
			toast.error('Выберите хотя бы один канал SLA-напоминаний.')
			return
		}
		if (config.enabled && !binding && !config.notifyManagers) {
			toast.error('Для включения SLA выберите получателя уведомлений.')
			return
		}
		if (!parseSlaConfig(config)) {
			toast.error(
				'Укажите 1–1440 рабочих минут, рабочие дни и интервал не короче 30 минут в пределах одного дня.'
			)
			return
		}
		if (binding && !selected) {
			toast.error(
				'Подтвердите ответственного в актуальном списке сотрудников.'
			)
			return
		}
		void command.execute(() => ({
			schemaVersion: 1,
			workspaceId: context.workspace.workspaceId,
			commandId: crypto.randomUUID(),
			expectedVersion: response.rule?.version ?? 0,
			config
		}))
	}
	return (
		<form className={styles.form} onSubmit={submit}>
			{!context.canWrite ? (
				<ReadOnlyBanner description="Настройки SLA доступны для просмотра. Изменения разрешены владельцу и администратору при действующем доступе к CRM." />
			) : null}
			<label className={styles.check}>
				<input
					type="checkbox"
					checked={config.enabled}
					disabled={disabled}
					onChange={event => set('enabled', event.target.checked)}
				/>
				Включить правило SLA
			</label>
			<div className={styles.fields}>
				<TextField
					label="Время на принятие в работу, рабочих минут"
					type="number"
					min={1}
					max={1440}
					step={1}
					value={config.workingMinutes}
					disabled={disabled}
					onChange={event =>
						set('workingMinutes', Number(event.target.value))
					}
				/>
				<TimeZoneSelect
					value={config.timeZone}
					disabled={disabled}
					onChange={value => set('timeZone', value)}
				/>
				<TextField
					label="Начало рабочего дня"
					type="time"
					value={config.workStart}
					disabled={disabled}
					onChange={event => set('workStart', event.target.value)}
				/>
				<TextField
					label="Конец рабочего дня"
					type="time"
					value={config.workEnd}
					disabled={disabled}
					onChange={event => set('workEnd', event.target.value)}
				/>
			</div>
			<fieldset className={styles.checks} disabled={disabled}>
				<legend>Рабочие дни</legend>
				{weekdayLabels.map((label, index) => (
					<label key={label} className={styles.check}>
						<input
							type="checkbox"
							checked={config.weekdays.includes(index + 1)}
							onChange={event =>
								set(
									'weekdays',
									event.target.checked
										? [...config.weekdays, index + 1].sort((a, b) => a - b)
										: config.weekdays.filter(day => day !== index + 1)
								)
							}
						/>
						{label}
					</label>
				))}
			</fieldset>
			<AssigneeSelect
				options={options}
				value={selected ?? binding}
				disabled={disabled}
				label="Ответственный за SLA"
				onChange={option =>
					set('responsibleBinding', {
						subject: option.subject,
						membershipId:
							option.role === 'OWNER' ? null : option.membershipId
					})
				}
			/>
			{binding ? (
				<Button
					variant="secondary"
					disabled={disabled}
					onClick={() => {
						set('responsibleBinding', null)
						toast('Ответственный за SLA убран')
					}}
				>
					Убрать ответственного за SLA
				</Button>
			) : null}
			<label className={styles.check}>
				<input
					type="checkbox"
					checked={config.notifyManagers}
					disabled={disabled}
					onChange={event => set('notifyManagers', event.target.checked)}
				/>
				Уведомлять руководителей
			</label>
			<fieldset className={styles.checks} disabled={disabled}>
				<legend>Каналы SLA-напоминаний</legend>
				{(['EMAIL', 'TELEGRAM'] as const).map(channel => (
					<label key={channel} className={styles.check}>
						<input
							type="checkbox"
							checked={config.channels.includes(channel)}
							onChange={event =>
								set(
									'channels',
									event.target.checked
										? [...config.channels, channel]
										: config.channels.filter(value => value !== channel)
								)
							}
						/>
						{channel === 'EMAIL' ? 'Email' : 'Telegram'}
					</label>
				))}
			</fieldset>
			<p className={styles.notice}>
				Выбор канала не подключает его автоматически: у получателя должен
				быть настроен соответствующий канал уведомлений.
			</p>
			{command.error ? (
				<p className={styles.error} role="alert">
					{command.error.message}
				</p>
			) : null}
			<div className={styles.actions}>
				<Button
					type="submit"
					disabled={disabled || (!!binding && !selected)}
				>
					Сохранить SLA
				</Button>
				{command.uncertain ? (
					<Button
						variant="secondary"
						disabled={!context.canWrite || command.running}
						onClick={() => void command.execute()}
					>
						Повторить ту же команду SLA
					</Button>
				) : null}
				{command.error?.kind === 'conflict' ? (
					<Button
						variant="secondary"
						onClick={() => {
							command.reset()
							onSaved()
							toast('Загружаем актуальную версию SLA')
						}}
					>
						Загрузить актуальную версию SLA
					</Button>
				) : null}
			</div>
		</form>
	)
}

export const SlaSettingsBody = ({ context }: { context: SlaContext }) => {
	const client = useQueryClient()
	const query = useQuery({
		queryKey: [
			'crm-intake-sla-rule',
			context.workspace.workspaceId,
			context.key
		],
		enabled: context.canRead,
		queryFn: async () => {
			if (!context.current() || !context.session)
				throw new AuthenticatedApiError(
					'forbidden',
					'Доступ к SLA не подтверждён.'
				)
			const result = await getSlaRule(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			if (!context.current())
				throw new AuthenticatedApiError(
					'forbidden',
					'Доступ к SLA изменился.'
				)
			return result
		},
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	if (!context.canRead) return null
	const data = !query.isError && !query.isFetching ? query.data : undefined
	const notFound =
		query.error instanceof AuthenticatedApiError &&
		query.error.kind === 'notFound'
	const refresh = () => {
		void client.invalidateQueries({
			queryKey: ['crm-intake-sla-rule', context.workspace.workspaceId]
		})
		void client.invalidateQueries({
			queryKey: ['crm-inbox-sla', context.workspace.workspaceId]
		})
	}
	return (
		<section className={styles.panel} aria-label="SLA входящих обращений">
			<div className={styles.heading}>
				<h2>SLA входящих обращений</h2>
				<p className={styles.notice}>
					Контроль времени до принятия обращения в работу по рабочему
					календарю. Принятие в работу фиксируется запросом обработки,
					отдельный статус не добавляется.
				</p>
				<p className={styles.notice}>
					Правило применяется только к новым обращениям после сохранения.
					Изменение правила останавливает напоминания предыдущей версии;
					старые обращения не пересчитываются.
				</p>
				{data ? (
					<StatusBadge
						tone={
							data.deliveryEnabled && data.rule?.config.enabled
								? 'success'
								: 'neutral'
						}
					>
						{!data.deliveryEnabled
							? 'SLA не активирован'
							: data.rule?.config.enabled
								? 'Правило SLA включено'
								: 'Правило SLA выключено'}
					</StatusBadge>
				) : null}
				{data && !data.deliveryEnabled ? (
					<p className={styles.notice}>
						Доставка SLA-напоминаний ещё не активирована на сервере.
						Настройки можно подготовить, но отправка уведомлений не
						работает.
					</p>
				) : null}
			</div>
			{query.isError ? (
				<ScreenState
					compact
					variant={notFound ? 'empty' : 'error'}
					title={notFound ? 'SLA пока не активирован' : 'SLA недоступен'}
					description="Сервер не подтвердил доступность SLA. Настройки и отправку напоминаний нельзя считать работающими."
					action={
						<Button
							variant="secondary"
							onClick={() => {
								void query.refetch()
								toast('Проверяем доступность SLA')
							}}
						>
							Проверить SLA
						</Button>
					}
				/>
			) : !data ? (
				<ScreenState
					compact
					variant="loading"
					description="Проверяем доступность SLA"
				/>
			) : (
				<SlaForm
					key={`${context.key}:${data.rule?.version ?? 0}`}
					context={context}
					response={data}
					onSaved={refresh}
				/>
			)}
		</section>
	)
}

export const SlaSettings = () => {
	const context = useSlaSession()
	return <SlaSettingsBody key={context.key} context={context} />
}
