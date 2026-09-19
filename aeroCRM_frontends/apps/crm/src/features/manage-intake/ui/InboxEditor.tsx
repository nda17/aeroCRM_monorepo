'use client'

import { TeamSelect, useTeamOptions } from '@/entities/crm-team'
import {
	CRM_PHONE_INPUT_ERROR,
	CRM_PHONE_INPUT_MAX_LENGTH,
	CRM_PHONE_INPUT_PLACEHOLDER,
	formatCrmPhoneInput,
	isCrmPhoneInputValid,
	parseCrmPhoneInput
} from '@/shared/lib/phone'
import {
	getInboxEntry,
	listIntakeActivities,
	mutateInbox,
	type IntakeActivity
} from '@/entities/intake'
import {
	Button,
	Drawer,
	ScreenState,
	TextField,
	TextareaField
} from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import toast from 'react-hot-toast'
import type { IntakeAccess } from '../model/use-intake-access'
import { useIntakeCommand } from '../model/use-intake-command'
import { useInboxAcceptance } from '../model/use-inbox-acceptance'
import { InboxAcceptancePanel } from './InboxAcceptancePanel'
import styles from './IntakeForms.module.scss'

interface Props {
	access: IntakeAccess
	id?: string
	onClose: () => void
	onSaved: () => void
}
interface Draft {
	title: string
	name: string
	phone: string
	email: string
	message: string
	teamId: string
	reason: string
}
const statusName = {
	NEW: 'Новое',
	ACCEPTED: 'Принято в работу',
	REJECTED: 'Отклонено'
}
const activityName: Record<IntakeActivity['action'], string> = {
	CREATED: 'Обращение создано',
	REJECTED: 'Обращение отклонено',
	ACCEPTANCE_REQUESTED: 'Запрошено принятие в работу',
	ACCEPTANCE_RETRIED: 'Запрошена повторная обработка',
	ACCEPTANCE_RECOVERY_REQUESTED: 'Запрошена безопасная остановка',
	ACCEPTANCE_CANCELLED: 'Обработка остановлена',
	ACCEPTED: 'Обращение принято в работу'
}

export const InboxEditor = ({ access, id, onClose, onSaved }: Props) => {
	const [historyPage, setHistoryPage] = useState(1)
	const [rejecting, setRejecting] = useState(false)
	const form = useForm<Draft>({
		defaultValues: {
			title: '',
			name: '',
			phone: '',
			email: '',
			message: '',
			teamId: '',
			reason: ''
		}
	})
	const teamId = useWatch({ control: form.control, name: 'teamId' })
	const teams = useTeamOptions(
		{
			workspaceId: access.workspaceId,
			subject: access.session?.userId,
			accessToken: access.session?.accessToken,
			sessionRevision: access.revision,
			permissionScope: access.scopeKey,
			teamIds: access.permissions.data?.teamIds ?? [],
			enabled: !id && access.canRead
		},
		teamId
	)
	const record = useQuery({
		queryKey: [
			'crm-intake-entry',
			access.workspaceId,
			access.session?.userId,
			access.revision,
			access.scopeKey,
			id
		],
		enabled: !!id && access.canRead,
		queryFn: () =>
			getInboxEntry(access.session!.accessToken, access.workspaceId, id!),
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const history = useQuery({
		queryKey: [
			'crm-intake-history',
			access.workspaceId,
			access.session?.userId,
			access.revision,
			access.scopeKey,
			id,
			historyPage
		],
		enabled: !!id && access.canRead && !!record.data && !record.isError,
		queryFn: () =>
			listIntakeActivities(
				access.session!.accessToken,
				access.workspaceId,
				id!,
				historyPage
			),
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const command = useIntakeCommand(
		access,
		'intake:write',
		mutateInbox,
		() => {
			toast.success(id ? 'Обращение отклонено' : 'Обращение создано')
			onSaved()
			onClose()
		},
		`inbox:${id ?? 'new'}`
	)
	const acceptance = useInboxAcceptance(access, id)
	const denied =
		!command.uncertain &&
		command.error &&
		['unauthorized', 'forbidden'].includes(command.error.kind)
	const conflict = !command.uncertain && command.error?.kind === 'conflict'
	const editable =
		access.canWrite &&
		!command.locked &&
		!denied &&
		!conflict &&
		!acceptance.blocksEntry
	const close = () => {
		if (command.locked || acceptance.command.locked) {
			toast(
				'Сначала повторите запрос с неизвестным результатом. Сохранены те же поля и ключ команды.'
			)
			return
		}
		onClose()
	}
	const submit = form.handleSubmit(
		draft => {
			if (!editable) return
			if (!id && !teams.validSelection) {
				toast.error('Выберите доступный отдел или «Без отдела»')
				return
			}
			void command.run(() =>
				id
					? {
							operation: 'reject',
							workspaceId: access.workspaceId,
							commandId: crypto.randomUUID(),
							id,
							expectedVersion: record.data!.version,
							reason: draft.reason.trim()
						}
					: {
							operation: 'create',
							workspaceId: access.workspaceId,
							commandId: crypto.randomUUID(),
							title: draft.title.trim(),
							name: draft.name.trim(),
							phone: parseCrmPhoneInput(draft.phone),
							email: draft.email.trim().toLowerCase() || null,
							message: draft.message.trim() || null,
							teamId: draft.teamId || null
						}
			)
		},
		() => toast.error('Проверьте выделенные поля')
	)
	const reload = async () => {
		const result = await record.refetch()
		if (result.isSuccess) {
			command.resetError()
			toast(
				'Карточка обновлена. Причина отклонения сохранена — проверьте новую версию перед отправкой.'
			)
		} else toast.error('Не удалось обновить карточку')
	}
	const entry = record.isError ? undefined : record.data
	return (
		<Drawer
			isOpen
			onClose={close}
			title={id ? 'Входящее обращение' : 'Новое обращение'}
			description="Данные сохраняются в выбранном рабочем пространстве aeroCRM."
		>
			<div className={styles.form}>
				{!access.canRead ? (
					<ScreenState
						variant={access.permissions.isError ? 'error' : 'permission'}
						description="Доступ сейчас не подтверждён. Черновик сохранён в открытой панели."
						action={
							<Button onClick={() => void access.permissions.refetch()}>
								Проверить доступ
							</Button>
						}
					/>
				) : id && !entry ? (
					<ScreenState
						variant={record.isError ? 'error' : 'loading'}
						description={record.error?.message}
						action={
							record.isError ? (
								<Button onClick={() => void record.refetch()}>
									Повторить
								</Button>
							) : undefined
						}
					/>
				) : (
					<>
						{id && command.uncertain ? (
							<div className={styles.notice} role="alert">
								<p>
									Есть сохранённая команда с неподтверждённым результатом.
									Новая команда не будет создана.
								</p>
								<Button
									disabled={!access.canWrite || command.running}
									onClick={() => void command.retry()}
								>
									Повторить тот же запрос
								</Button>
							</div>
						) : null}
						{entry ? (
							<>
								<dl className={styles.details}>
									{[
										['Тема', entry.title],
										['Статус', statusName[entry.status]],
										['Клиент', entry.name ?? 'Имя не передано'],
										['Телефон', entry.phone ?? '—'],
										['Email', entry.email ?? '—'],
										[
											'Источник',
											entry.origin === 'MANUAL'
												? 'Добавлено вручную'
												: entry.origin === 'CSV'
													? 'Импорт CSV'
														: `API · ${entry.sourceId}`
										],
										[
											'Получено',
											new Date(entry.receivedAt).toLocaleString('ru-RU')
										],
										['Сообщение', entry.message ?? '—'],
										...(entry.rejectionReason
											? [['Причина отклонения', entry.rejectionReason]]
											: [])
									].map(([label, value]) => (
										<div key={label}>
											<dt>{label}</dt>
											<dd>{value}</dd>
										</div>
									))}
								</dl>

								<InboxAcceptancePanel
									key={access.scopeKey}
									access={access}
									entry={entry}
									context={acceptance}
									competingCommand={command.locked || rejecting}
								/>
								{entry.status === 'NEW' ? (
									<div className={styles.actions}>
										{access.canWrite && !rejecting ? (
											<Button
												variant="danger"
												disabled={command.locked || acceptance.blocksEntry}
												onClick={() => setRejecting(true)}
											>
												Отклонить
											</Button>
										) : null}
										{rejecting && !command.locked ? (
											<Button
												variant="secondary"
												onClick={() => setRejecting(false)}
											>
												Отменить отклонение
											</Button>
										) : null}
									</div>
								) : null}
							</>
						) : null}
						{!id ||
						(rejecting &&
							!command.uncertain &&
							entry?.status === 'NEW') ? (
							<form
								className={styles.form}
								onSubmit={event => {
									if (command.uncertain) {
										event.preventDefault()
										void command.retry()
									} else void submit(event)
								}}
								noValidate
							>
								{!id ? (
									<>
										<TextField
											label="Тема обращения"
											required
											maxLength={200}
											readOnly={!editable}
											error={form.formState.errors.title?.message}
											{...form.register('title', {
												required: 'Укажите тему',
												validate: value =>
													!!value.trim() || 'Укажите тему',
												maxLength: 200
											})}
										/>
										<TextField
											label="Имя клиента"
											required
											maxLength={200}
											readOnly={!editable}
											error={form.formState.errors.name?.message}
											{...form.register('name', {
												required: 'Укажите имя',
												validate: value => !!value.trim() || 'Укажите имя',
												maxLength: 200
											})}
										/>
										<div className={styles.row}>
											<Controller
												name="phone"
												control={form.control}
												rules={{
													validate: value =>
														isCrmPhoneInputValid(value) ||
														CRM_PHONE_INPUT_ERROR
												}}
												render={({ field }) => (
													<TextField
														{...field}
														label="Телефон"
														type="tel"
														inputMode="tel"
														autoComplete="tel"
														placeholder={CRM_PHONE_INPUT_PLACEHOLDER}
														maxLength={CRM_PHONE_INPUT_MAX_LENGTH}
														readOnly={!editable}
														error={form.formState.errors.phone?.message}
														onChange={event => {
															if (editable)
																field.onChange(
																	formatCrmPhoneInput(
																		event.currentTarget.value
																	)
																)
														}}
													/>
												)}
											/>
											<TextField
												label="Email"
												type="email"
												maxLength={254}
												readOnly={!editable}
												error={form.formState.errors.email?.message}
												{...form.register('email', {
													validate: value =>
														!value ||
														/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
														'Проверьте email'
												})}
											/>
										</div>
										<TextareaField
											label="Сообщение"
											maxLength={5000}
											readOnly={!editable}
											{...form.register('message')}
										/>
										{access.permissions.data?.teamIds.length || teamId ? (
											<TeamSelect
												options={teams}
												value={teamId}
												disabled={!editable}
												onChange={value =>
													form.setValue('teamId', value, {
														shouldDirty: true
													})
												}
											/>
										) : null}
									</>
								) : (
									<TextareaField
										label="Причина отклонения"
										required
										maxLength={2000}
										readOnly={!editable}
										error={form.formState.errors.reason?.message}
										{...form.register('reason', {
											required: 'Укажите причину',
											validate: value =>
												!!value.trim() || 'Укажите причину'
										})}
									/>
								)}
								{command.uncertain ? (
									<p className={styles.notice}>
										Результат пока неизвестен. Поля зафиксированы; повтор
										отправит ту же команду и не создаст дубль.
									</p>
								) : null}
								<Button
									type="submit"
									tooltip={
										command.uncertain
											? 'Повторить прежний запрос с теми же данными, не создавая второе обращение.'
											: id
												? 'Отклонить обращение с указанной причиной. Запись и история сохранятся.'
												: 'Сохранить обращение во входящих. Принятие в работу выполняется отдельно.'
									}
									isLoading={command.running}
									disabled={
										!access.canWrite ||
										!!denied ||
										conflict ||
										(!id && !command.uncertain && !teams.validSelection) ||
										acceptance.blocksEntry
									}
								>
									{command.uncertain
										? 'Повторить тот же запрос'
										: id
											? 'Подтвердить отклонение'
											: 'Создать обращение'}
								</Button>
							</form>
						) : null}
						{entry ? (
							<section
								className={styles.history}
								aria-label="История обращения"
							>
								<h3>История</h3>
								{history.isError ? (
									<ScreenState
										compact
										variant="error"
										description={history.error.message}
										action={
											<Button onClick={() => void history.refetch()}>
												Повторить историю
											</Button>
										}
									/>
								) : history.isPending ? (
									<ScreenState compact variant="loading" />
								) : (
									<>
										<ol>
											{history.data.items.map(item => (
												<li key={item.id}>
													<strong>{activityName[item.action]}</strong>
													{new Date(item.createdAt).toLocaleString(
														'ru-RU'
													)}{' '}
													· версия {item.entityVersion}
												</li>
											))}
										</ol>
										<div className={styles.actions}>
											<Button
												variant="secondary"
												disabled={historyPage === 1}
												onClick={() => setHistoryPage(page => page - 1)}
											>
												Предыдущие события
											</Button>
											<span>
												{historyPage} /{' '}
												{Math.max(1, Math.ceil(history.data.total / 25))}
											</span>
											<Button
												variant="secondary"
												disabled={historyPage * 25 >= history.data.total}
												onClick={() => setHistoryPage(page => page + 1)}
											>
												Следующие события
											</Button>
										</div>
									</>
								)}
							</section>
						) : null}
					</>
				)}
				{command.error ? (
					<div className={styles.error} role="alert">
						<p>{command.error.message}</p>
						{conflict && id ? (
							<Button variant="secondary" onClick={() => void reload()}>
								Перечитать карточку
							</Button>
						) : null}
					</div>
				) : null}
				{!access.online ? (
					<p className={styles.notice}>
						Нет подключения к сети. Отправка приостановлена.
					</p>
				) : null}
				<Button
					variant="secondary"
					disabled={command.running || acceptance.command.running}
					onClick={close}
				>
					Закрыть
				</Button>
			</div>
		</Drawer>
	)
}
