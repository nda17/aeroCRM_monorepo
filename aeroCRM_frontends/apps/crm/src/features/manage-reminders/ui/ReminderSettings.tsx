'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import toast from 'react-hot-toast'
import {
	listReminderRules,
	type ReminderItem,
	type ReminderScope
} from '@/entities/crm-reminders'
import { Button, ScreenState, SelectField } from '@/shared/ui'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import {
	useReminderSession,
	type ReminderContext
} from '../model/use-reminder-session'
import { useReminderCommand } from '../model/use-reminder-command'
import { ReminderRuleForm } from './ReminderRuleForm'
import styles from './ReminderSettings.module.scss'

export const ReminderSettings = () => {
	const context = useReminderSession()
	return (
		<section className={styles.panel} aria-label="Напоминания о задачах">
			<h2>Напоминания о задачах</h2>
			<p className={styles.notice}>
				Email и Telegram о сроках и назначениях задач. Личные правила — для
				назначенных вам задач; общие — для рабочего пространства. Канал
				должен быть подтверждён и подключён у получателя.
			</p>
			<ReminderSettingsBody
				key={JSON.stringify([context.key, context.actor])}
				context={context}
			/>
		</section>
	)
}

export const ReminderSettingsBody = ({
	context
}: {
	context: ReminderContext
}) => {
	const [scope, setScope] = useState<ReminderScope>('PERSONAL')
	const [archived, setArchived] = useState(false)
	const [page, setPage] = useState(1)
	const [editor, setEditor] = useState<ReminderItem | 'new' | null>(null)
	const ready =
		context.canRead && context.actorConfirmed && !!context.actor
	const writable =
		ready &&
		context.canWrite &&
		(scope === 'PERSONAL' ||
			['OWNER', 'CRM_ADMIN'].includes(context.authority?.role ?? ''))
	const records = useQuery({
		queryKey: [
			'crm-reminders',
			context.workspace.workspaceId,
			context.key,
			context.actor,
			scope,
			archived,
			page
		],
		enabled: ready,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		queryFn: async () => {
			if (!context.current() || !context.actor)
				throw invalidContractError()
			const result = await listReminderRules(
				context.session!.accessToken,
				{
					workspaceId: context.workspace.workspaceId,
					actor: context.actor,
					scope,
					archived,
					page,
					pageSize: 10
				}
			)
			if (!context.current()) throw invalidContractError()
			return result
		}
	})
	const command = useReminderCommand(context, scope, writable, () =>
		setEditor(null)
	)
	const blocked =
		!!command.error &&
		!command.uncertain &&
		command.error.kind !== 'validation'
	const locked = command.locked || blocked
	const visible = ready && records.isSuccess && !records.isFetching
	const change = (action: () => void) => {
		if (command.locked) {
			toast('Сначала подтвердите результат сохранённой команды.')
			return
		}
		if (!context.current()) return
		setEditor(null)
		command.reset()
		action()
	}
	const canEdit = writable && visible && !locked
	const pages = Math.max(1, Math.ceil((records.data?.total ?? 0) / 10))
	return (
		<div className={styles.content}>
			<div className={styles.actions}>
				<SelectField
					label="Правила"
					value={scope}
					disabled={!ready || command.locked}
					onChange={event =>
						change(() => {
							setScope(event.target.value as ReminderScope)
							setPage(1)
							toast('Раздел напоминаний изменён')
						})
					}
				>
					<option value="PERSONAL">Мои личные</option>
					<option value="WORKSPACE">Общие</option>
				</SelectField>
				<label className={styles.check}>
					<input
						type="checkbox"
						checked={archived}
						disabled={!ready || command.locked}
						onChange={event =>
							change(() => {
								setArchived(event.target.checked)
								setPage(1)
								toast('Список правил обновлён')
							})
						}
					/>
					Архив правил
				</label>
				<Button
					variant="secondary"
					disabled={!ready || command.locked || records.isFetching}
					onClick={() =>
						change(() => {
							void records.refetch()
							void context.self.refetch()
							toast('Обновляем правила')
						})
					}
				>
					Обновить правила
				</Button>
				<Button
					disabled={
						!canEdit ||
						archived ||
						(records.data?.total ?? 0) >=
							(records.data?.limits[scope] ?? 0)
					}
					onClick={() => {
						if (context.current()) {
							setEditor('new')
							toast('Новое правило')
						}
					}}
				>
					Добавить правило
				</Button>
			</div>
			{!context.canRead ? (
				<ScreenState
					compact
					variant={
						context.permissions.isError
							? 'error'
							: context.authority?.role === 'ANALYST'
								? 'permission'
								: 'loading'
					}
					description="Настройки доступны после подтверждения права чтения задач."
					action={
						<Button
							variant="secondary"
							onClick={() => void context.permissions.refetch()}
						>
							Проверить доступ
						</Button>
					}
				/>
			) : !context.actorConfirmed ? (
				<ScreenState
					compact
					variant={
						context.self.error || !context.self.loading
							? 'error'
							: 'loading'
					}
					description="Не удалось подтвердить текущего сотрудника. Чужая или первая запись не используется."
					action={
						<Button
							variant="secondary"
							onClick={() => void context.self.refetch()}
						>
							Проверить сотрудника
						</Button>
					}
				/>
			) : records.isError ? (
				<ScreenState
					compact
					variant="error"
					description="Не удалось загрузить правила. Это не означает, что правил нет."
					action={
						<Button
							variant="secondary"
							onClick={() => void records.refetch()}
						>
							Повторить загрузку правил
						</Button>
					}
				/>
			) : !visible ? (
				<ScreenState compact variant="loading" />
			) : (
				<>
					{!records.data.deliveryReady ? (
						<p role="status" className={styles.notice}>
							Отправка напоминаний ещё не подключена. Можно сохранить
							выключенное правило; это не отправляет сообщения.
						</p>
					) : (
						<p className={styles.notice}>
							Сохранение настроек не подтверждает доставку сообщения.
							Отправка доступна только в действующие каналы получателя.
						</p>
					)}
					{!writable ? (
						<p className={styles.notice}>
							{context.authority?.state === 'READ_ONLY'
								? 'Доступ только для чтения. Новые напоминания не отправляются.'
								: 'Общие правила меняют владелец и администратор CRM.'}
						</p>
					) : null}
					<p className={styles.notice}>
						Всего: {records.data.total}. Лимит действующих правил:{' '}
						{records.data.limits[scope]}.
					</p>
					{records.data.items.length ? (
						<ul className={styles.rules}>
							{records.data.items.map(item => (
								<li key={item.rule.id}>
									<div>
										<strong>{item.rule.title}</strong>
										<p className={styles.notice}>
											{item.rule.enabled ? 'Включено' : 'Выключено'} ·{' '}
											{item.rule.channels
												.map(channel =>
													channel === 'EMAIL' ? 'Email' : 'Telegram'
												)
												.join(', ') || 'Каналы не выбраны'}{' '}
											· {item.rule.timeZone}
											{item.rule.trigger.kind === 'ASSIGNED'
												? ' · При назначении задачи'
												: ''}
										</p>
									</div>
									<Button
										variant="secondary"
										disabled={locked}
										onClick={() => {
											if (context.current()) {
												setEditor(item)
												toast('Правило открыто')
											}
										}}
									>
										Открыть правило
									</Button>
								</li>
							))}
						</ul>
					) : (
						<p className={styles.notice}>
							{records.data.total === 0
								? 'Правил пока нет.'
								: 'На этой странице правил больше нет.'}
						</p>
					)}
					<div className={styles.actions}>
						<Button
							variant="secondary"
							disabled={page <= 1 || command.locked}
							onClick={() =>
								change(() => {
									setPage(page - 1)
									toast('Предыдущая страница правил')
								})
							}
						>
							Назад
						</Button>
						<span>
							{page <= pages
								? `${page} / ${pages}`
								: 'Страница больше не существует'}
						</span>
						<Button
							variant="secondary"
							disabled={page >= pages || command.locked}
							onClick={() =>
								change(() => {
									setPage(page + 1)
									toast('Следующая страница правил')
								})
							}
						>
							Далее
						</Button>
						{page > pages ? (
							<Button
								variant="secondary"
								onClick={() => change(() => setPage(1))}
							>
								На первую страницу
							</Button>
						) : null}
					</div>
				</>
			)}
			{command.error ? (
				<p role="alert" className={styles.error}>
					{command.error.message}
				</p>
			) : null}
			{command.uncertain ? (
				<div className={styles.actions}>
					<p className={styles.notice}>
						Результат неизвестен. Повтор использует ту же команду, без
						создания дубля.
					</p>
					<Button
						disabled={!writable || command.running}
						onClick={() => void command.execute()}
					>
						Проверить результат сохранения
					</Button>
				</div>
			) : null}
			{editor && context.actor ? (
				<div hidden={!ready}>
					<ReminderRuleForm
						key={
							editor === 'new'
								? 'new'
								: `${editor.rule.id}:${editor.version}`
						}
						scope={scope}
						actor={context.actor}
						initial={editor === 'new' ? undefined : editor}
						context={context}
						disabled={!canEdit || archived}
						deliveryReady={visible && records.data.deliveryReady}
						onClose={() => change(() => toast('Правило закрыто'))}
						onSave={rule => {
							if (
								!canEdit ||
								!context.current() ||
								(rule.enabled && !records.data?.deliveryReady)
							)
								return
							void command.execute(() => ({
								commandId: crypto.randomUUID(),
								workspaceId: context.workspace.workspaceId,
								actor: context.actor!,
								action: editor === 'new' ? 'create' : 'edit',
								rule,
								...(editor === 'new'
									? {}
									: { expectedVersion: editor.version })
							}))
						}}
						onArchive={
							editor !== 'new' && !archived
								? () => {
										if (
											!canEdit ||
											!context.current() ||
											!window.confirm('Архивировать правило напоминания?')
										)
											return
										void command.execute(() => ({
											commandId: crypto.randomUUID(),
											workspaceId: context.workspace.workspaceId,
											actor: context.actor!,
											action: 'archive',
											rule: editor.rule,
											expectedVersion: editor.version
										}))
									}
								: undefined
						}
					/>
				</div>
			) : null}
		</div>
	)
}
