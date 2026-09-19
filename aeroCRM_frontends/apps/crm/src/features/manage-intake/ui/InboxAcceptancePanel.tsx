'use client'

import { listCustomers, type Customer } from '@/entities/customer'
import {
	isAcceptanceTerminal,
	type InboxEntry,
	type AcceptanceStatus
} from '@/entities/intake'
import { listSalesPipelines } from '@/entities/sales'
import { useSessionStore } from '@/entities/session'
import { Button, ScreenState, SelectField, TextField } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import type { InboxAcceptanceContext } from '../model/use-inbox-acceptance'
import type { IntakeAccess } from '../model/use-intake-access'
import styles from './IntakeForms.module.scss'

const labels: Record<AcceptanceStatus, string> = {
	QUEUED: 'Ожидает обработки',
	RUNNING: 'Создаём контакт и сделку',
	RETRY_WAIT: 'Ожидает повторной обработки',
	BLOCKED: 'Нужна проверка доступа',
	FAILED: 'Требуется внимание',
	RECOVERING: 'Проверяем и останавливаем обработку',
	CANCELLED: 'Обработка остановлена',
	COMPLETED: 'Принято в работу'
}
const descriptions = {
	WORKFLOW_ACCESS_BLOCKED:
		'Права инициатора или подписка изменились. Повторная обработка проверит их заново, сохранив исходного ответственного.',
	WORKFLOW_REFERENCE_CONFLICT:
		'Контакт, команда или воронка больше не подходят для исходной команды. Администратор может безопасно остановить обработку; уже созданный контакт сохранится.',
	WORKFLOW_DEPENDENCY_UNAVAILABLE:
		'Один из сервисов временно недоступен. Подтверждённые шаги сохранены; повтор не создаст их заново.'
}
export const parseAcceptanceAmount = (value: string) => {
	if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(value.trim())) return null
	const [whole, fraction = ''] = value.trim().replace(',', '.').split('.')
	const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
	return minor <= 2147483647n ? Number(minor) : null
}

export const InboxAcceptancePanel = ({
	access,
	entry,
	context,
	competingCommand
}: {
	access: IntakeAccess
	entry: InboxEntry
	context: InboxAcceptanceContext
	competingCommand: boolean
}) => {
	const [editing, setEditing] = useState(false)
	const [confirmRecovery, setConfirmRecovery] = useState(false)
	const { query, row, command } = context
	const refreshOwner = useRef<object | null>(null)
	useLayoutEffect(() => {
		refreshOwner.current = {}
		return () => {
			refreshOwner.current = null
		}
	}, [
		access.workspaceId,
		access.session?.userId,
		access.session?.accessToken,
		access.revision,
		access.scopeKey,
		access.canRead,
		access.permissions.isSuccess,
		access.permissions.isFetching,
		access.permissions.data?.state,
		entry.id
	])
	const admin = access.sourceManager
	const fresh =
		access.canRead &&
		query.isSuccess &&
		!query.isFetching &&
		!query.isError
	const available =
		fresh &&
		access.canWrite &&
		!competingCommand &&
		!command.locked &&
		!command.error
	const retryAllowed =
		!!row &&
		['BLOCKED', 'FAILED', 'RETRY_WAIT'].includes(row.status) &&
		(admin || row.actorSubject === access.session?.userId)
	const recoveryAllowed =
		!!row && !isAcceptanceTerminal(row.status) && admin
	const runAction = (operation: 'retry' | 'recover') => {
		if (
			!available ||
			!row ||
			(operation === 'retry' ? !retryAllowed : !recoveryAllowed)
		)
			return
		void command.run(() => ({
			operation,
			workspaceId: access.workspaceId,
			entryId: entry.id,
			commandId: crypto.randomUUID(),
			expectedVersion: row.version
		}))
		setConfirmRecovery(false)
	}
	const refresh = async () => {
		const owner = refreshOwner.current
		const current = () => {
			const state = useSessionStore.getState()
			return (
				owner !== null &&
				refreshOwner.current === owner &&
				access.canRead &&
				access.permissions.isSuccess &&
				!access.permissions.isFetching &&
				entry.workspaceId === access.workspaceId &&
				access.session !== null &&
				state.status === 'authenticated' &&
				state.session !== null &&
				state.session.userId === access.session.userId &&
				state.session.accessToken === access.session.accessToken &&
				state.sessionRevision === access.revision
			)
		}
		if (
			!current() ||
			!access.online ||
			!navigator.onLine ||
			query.isFetching
		)
			return
		const result = await query.refetch()
		if (!current()) return
		if (result.isSuccess) {
			command.resetError()
			toast(
				'Состояние обработки обновлено. Проверьте его перед новой командой.'
			)
		} else toast.error('Не удалось обновить состояние обработки')
	}
	return (
		<section
			className={styles.acceptance}
			aria-label="Принятие обращения в работу"
		>
			<h3>Принятие в работу</h3>
			{!access.canRead ? (
				<ScreenState compact variant="permission" />
			) : query.isError ? (
				<ScreenState
					compact
					variant="error"
					description="Не удалось проверить обработку. Новое принятие и отклонение временно недоступны."
					action={
						<Button onClick={() => void refresh()}>
							Проверить обработку
						</Button>
					}
				/>
			) : query.isPending ? (
				<ScreenState
					compact
					variant="loading"
					description="Проверяем состояние обработки"
				/>
			) : row ? (
				<div className={styles.notice} role="status" aria-live="polite">
					<strong>{labels[row.status]}</strong>
					{row.status === 'COMPLETED' ? (
						<p>
							Контакт, сделка и первое действие подтверждены. Они доступны
							в соответствующих разделах.
						</p>
					) : row.status === 'CANCELLED' ? (
						<p>
							Новые шаги прежней обработки заблокированы. Обращение можно
							снова проверить и принять в работу.
						</p>
					) : (
						<p>
							Запрос сохранён. Можно закрыть панель — обработка продолжится
							на сервере.
						</p>
					)}
					{row.lastErrorCode ? (
						<p>{descriptions[row.lastErrorCode]}</p>
					) : null}
					{row.contactId && row.status !== 'COMPLETED' ? (
						<p>
							Контакт уже сохранён:{' '}
							<span className={styles.reference}>{row.contactId}</span>. Он
							не будет удалён при остановке. При новом принятии выберите
							его в списке существующих контактов.
						</p>
					) : null}
					{row.retryAt && !isAcceptanceTerminal(row.status) ? (
						<p>
							Следующая попытка:{' '}
							{new Date(row.retryAt).toLocaleString('ru-RU')}
						</p>
					) : null}
					<p>
						Обновлено: {new Date(row.updatedAt).toLocaleString('ru-RU')}
					</p>
					<div className={styles.actions}>
						<Button
							variant="secondary"
							disabled={query.isFetching}
							onClick={() => void refresh()}
						>
							Обновить состояние
						</Button>
						{retryAllowed ? (
							<Button
								disabled={!available}
								onClick={() => runAction('retry')}
							>
								Повторить обработку
							</Button>
						) : null}
						{recoveryAllowed ? (
							<Button
								variant="secondary"
								disabled={!available}
								onClick={() => setConfirmRecovery(true)}
							>
								Безопасно остановить
							</Button>
						) : null}
					</div>
					{confirmRecovery ? (
						<div className={styles.form}>
							<p>
								Проверим результаты обоих сервисов и запретим ещё не
								выполненные шаги. Если сделка уже создана, обращение будет
								принято в работу. Данные не удаляются.
							</p>
							<div className={styles.actions}>
								<Button
									variant="secondary"
									onClick={() => setConfirmRecovery(false)}
								>
									Назад
								</Button>
								<Button
									variant="danger"
									disabled={!available}
									onClick={() => runAction('recover')}
								>
									Подтвердить остановку
								</Button>
							</div>
						</div>
					) : null}
				</div>
			) : null}
			{command.uncertain ? (
				<div className={styles.notice} role="alert">
					<p>
						Ответ на команду не подтверждён. Сохранены исходные поля и
						ключ; новая команда не создаётся.
					</p>
					<Button
						disabled={
							!access.canWrite || competingCommand || command.running
						}
						onClick={() => void command.retry()}
					>
						Повторить тот же запрос
					</Button>
				</div>
			) : command.running ? (
				<p role="status">Отправляем запрос…</p>
			) : null}
			{command.error ? (
				<div className={styles.error} role="alert">
					<p>{command.error.message}</p>
					{!command.locked ? (
						<Button variant="secondary" onClick={() => void refresh()}>
							Перечитать состояние
						</Button>
					) : null}
				</div>
			) : null}
			{entry.status === 'NEW' &&
			fresh &&
			(row === null || row?.status === 'CANCELLED') &&
			!command.uncertain ? (
				editing ? (
					<AcceptanceForm
						access={access}
						entry={entry}
						context={context}
						disabled={!available}
						onCancel={() => setEditing(false)}
					/>
				) : (
					<Button disabled={!available} onClick={() => setEditing(true)}>
						Принять в работу
					</Button>
				)
			) : null}
			{!access.canWrite && access.canRead ? (
				<p className={styles.notice}>
					Доступен только просмотр. Новое принятие, повтор и остановка
					требуют действующих прав на изменения.
				</p>
			) : null}
		</section>
	)
}

const AcceptanceForm = ({
	access,
	entry,
	context,
	disabled,
	onCancel
}: {
	access: IntakeAccess
	entry: InboxEntry
	context: InboxAcceptanceContext
	disabled: boolean
	onCancel: () => void
}) => {
	const [mode, setMode] = useState<'CREATE_FROM_ENTRY' | 'EXISTING'>(
		'EXISTING'
	)
	const [selected, setSelected] = useState<Customer | null>(null)
	const [searchInput, setSearchInput] = useState(entry.name ?? '')
	const [search, setSearch] = useState(entry.name ?? '')
	const [page, setPage] = useState(1)
	const [title, setTitle] = useState(entry.title)
	const [amount, setAmount] = useState('0')
	const [pipelineId, setPipelineId] = useState('')
	const [stageId, setStageId] = useState('')
	const [taskTitle, setTaskTitle] = useState('Связаться с клиентом')
	const [dueAt, setDueAt] = useState('')
	const scope = [
		access.workspaceId,
		access.session?.userId,
		access.revision,
		access.scopeKey
	]
	const canReadReferences =
		access.canRead &&
		access.permissions.data?.permissions.includes('customers:read') &&
		access.permissions.data.permissions.includes('sales:read')
	const contacts = useQuery({
		queryKey: ['crm-intake-contact-picker', ...scope, page, search],
		enabled: !!canReadReferences && mode === 'EXISTING',
		queryFn: () =>
			listCustomers(
				access.session!.accessToken,
				'contacts',
				access.workspaceId,
				page,
				20,
				search
			),
		retry: false,
		gcTime: 0
	})
	const pipelines = useQuery({
		queryKey: ['crm-intake-pipeline-picker', ...scope],
		enabled: !!canReadReferences,
		queryFn: () =>
			listSalesPipelines(access.session!.accessToken, access.workspaceId),
		retry: false,
		gcTime: 0
	})
	const currentPipeline = pipelines.data?.find(
		item => item.id === pipelineId
	)
	const ready =
		!disabled &&
		!!canReadReferences &&
		pipelines.isSuccess &&
		!pipelines.isFetching &&
		(mode === 'CREATE_FROM_ENTRY' ||
			(!!selected && contacts.isSuccess && !contacts.isFetching))
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!ready) return
		const amountMinor = parseAcceptanceAmount(amount)
		if (
			!title.trim() ||
			!taskTitle.trim() ||
			amountMinor === null ||
			!currentPipeline?.stages.some(
				stage => stage.id === stageId && stage.state === 'OPEN'
			) ||
			!Number.isFinite(Date.parse(dueAt)) ||
			(mode === 'EXISTING' && !selected)
		) {
			toast.error(
				'Проверьте контакт, воронку, этап, сумму и первое действие'
			)
			return
		}
		void context.command.run(() => ({
			operation: 'accept',
			workspaceId: access.workspaceId,
			entryId: entry.id,
			commandId: crypto.randomUUID(),
			expectedVersion: entry.version,
			contact:
				mode === 'EXISTING'
					? { mode, contactId: selected!.id }
					: { mode },
			deal: {
				title: title.trim(),
				currency: 'RUB',
				amountMinor,
				pipelineId,
				stageId,
				nextTask: {
					title: taskTitle.trim(),
					dueAt: new Date(dueAt).toISOString()
				}
			}
		}))
	}
	return (
		<form className={styles.form} onSubmit={submit}>
			{!canReadReferences ? (
				<ScreenState
					compact
					variant="permission"
					description="Для принятия нужны права на контакты и сделки."
				/>
			) : null}
			<fieldset
				className={styles.fields}
				disabled={disabled || !canReadReferences}
			>
				<SelectField
					label="Контакт"
					value={mode}
					onChange={event => setMode(event.target.value as typeof mode)}
				>
					<option value="EXISTING">Выбрать существующий</option>
					<option value="CREATE_FROM_ENTRY">Создать из обращения</option>
				</SelectField>
				{mode === 'CREATE_FROM_ENTRY' ? (
					<>

						<p className={styles.notice}>
							Создадим новый контакт «{entry.name}»
							с телефоном и email из обращения. Автоматического объединения
							нет. Проверьте, не существует ли этот клиент уже.
						</p>
					</>
				) : (
					<>
						<div className={styles.row}>
							<TextField
								label="Поиск контакта"
								value={searchInput}
								maxLength={200}
								onChange={event => setSearchInput(event.target.value)}
							/>
							<Button
								variant="secondary"
								onClick={() => {
									setSearch(searchInput.trim())
									setPage(1)
								}}
							>
								Найти
							</Button>
						</div>
						{contacts.isError ? (
							<ScreenState
								compact
								variant="error"
								description="Не удалось загрузить контакты"
								action={
									<Button onClick={() => void contacts.refetch()}>
										Повторить поиск
									</Button>
								}
							/>
						) : contacts.isPending || contacts.isFetching ? (
							<ScreenState compact variant="loading" />
						) : (
							<>
								{contacts.data.items.length ? (
									<ul
										className={styles.choices}
										aria-label="Найденные контакты"
									>
										{contacts.data.items.map(contact => (
											<li key={contact.id}>
												<Button
													variant={
														selected?.id === contact.id
															? 'primary'
															: 'secondary'
													}
													aria-pressed={selected?.id === contact.id}
													onClick={() => setSelected(contact)}
												>
													{contact.name}
													<span>
														{contact.kind === 'contacts'
															? (contact.email ??
																contact.phone ??
																'Без телефона и email')
															: 'Компания'}
													</span>
												</Button>
											</li>
										))}
									</ul>
								) : (
									<p className={styles.notice}>
										Контакты не найдены. Измените поиск или явно выберите
										создание нового.
									</p>
								)}
								<div className={styles.actions}>
									<Button
										variant="secondary"
										disabled={page === 1}
										onClick={() => setPage(value => value - 1)}
									>
										Назад
									</Button>
									<span>
										{page} /{' '}
										{Math.max(1, Math.ceil(contacts.data.total / 20))}
									</span>
									<Button
										variant="secondary"
										disabled={page * 20 >= contacts.data.total}
										onClick={() => setPage(value => value + 1)}
									>
										Далее
									</Button>
								</div>
							</>
						)}
						{selected ? (
							<p className={styles.notice}>
								Выбран контакт: {selected.name}
								<span className={styles.reference}>{selected.id}</span>
							</p>
						) : null}
					</>
				)}
				<TextField
					label="Название сделки"
					required
					maxLength={200}
					value={title}
					onChange={event => setTitle(event.target.value)}
				/>
				{pipelines.isError ? (
					<ScreenState
						compact
						variant="error"
						description="Не удалось загрузить воронки"
						action={
							<Button onClick={() => void pipelines.refetch()}>
								Повторить загрузку
							</Button>
						}
					/>
				) : pipelines.isPending || pipelines.isFetching ? (
					<ScreenState compact variant="loading" />
				) : !pipelines.data.length ? (
					<p className={styles.notice}>
						Нет доступной воронки. Сначала завершите настройку рабочего
						пространства.
					</p>
				) : (
					<div className={styles.row}>
						<SelectField
							label="Воронка"
							required
							value={pipelineId}
							onChange={event => {
								setPipelineId(event.target.value)
								setStageId('')
							}}
						>
							<option value="">Выберите воронку</option>
							{pipelines.data.map(pipeline => (
								<option key={pipeline.id} value={pipeline.id}>
									{pipeline.name}
								</option>
							))}
						</SelectField>
						<SelectField
							label="Начальный этап"
							required
							value={stageId}
							onChange={event => setStageId(event.target.value)}
						>
							<option value="">Выберите этап</option>
							{currentPipeline?.stages
								.filter(stage => stage.state === 'OPEN')
								.map(stage => (
									<option key={stage.id} value={stage.id}>
										{stage.name}
									</option>
								))}
						</SelectField>
					</div>
				)}
				<TextField
					label="Сумма сделки, ₽"
					inputMode="decimal"
					required
					value={amount}
					onChange={event => setAmount(event.target.value)}
				/>
				<TextField
					label="Первое действие"
					required
					maxLength={200}
					value={taskTitle}
					onChange={event => setTaskTitle(event.target.value)}
				/>
				<TextField
					label="Срок первого действия"
					type="datetime-local"
					required
					value={dueAt}
					onChange={event => setDueAt(event.target.value)}
				/>
				<p className={styles.notice}>
					Ответственным будете вы. Команда наследуется из обращения.
					Обращение станет принятым только после подтверждения контакта,
					сделки и задачи.
				</p>
			</fieldset>
			<div className={styles.actions}>
				<Button
					variant="secondary"
					disabled={context.command.locked}
					onClick={onCancel}
				>
					Вернуться к обращению
				</Button>
				<Button
					type="submit"
					disabled={!ready}
					tooltip="Запустить создание или привязку контакта, сделки и первой задачи. Обращение станет принятым после завершения обработки."
					isLoading={context.command.running}
				>
					Начать обработку
				</Button>
			</div>
		</form>
	)
}
