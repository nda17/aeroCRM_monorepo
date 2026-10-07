'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
	Button,
	Drawer,
	ScreenState,
	TextareaField,
	TextField
} from '@/shared/ui'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import {
	createMailIntake,
	getMailIntakeCommand,
	getMailIntakePreview,
	type MailIntakeCreate,
	type MailIntakeCreated
} from '@/entities/intake/api/mail-intake.api'
import {
	useIntakeAccess,
	type IntakeAccess
} from '@/features/manage-intake/model/use-intake-access'
import { useMailContext } from '../model/use-mail-context'
import styles from '@/features/manage-intake/ui/IntakeForms.module.scss'

type Draft = {
	title: string
	name: string
	email: string
	message: string
	copyConfirmed: boolean
}

export const MailIntakeCopyControl = ({
	messageId
}: {
	messageId: string
}) => {
	const access = useIntakeAccess()
	const context = useMailContext()
	const [open, setOpen] = useState(false)
	if (access.confirmed && !access.canRead) return null
	return (
		<>
			<Button
				variant="secondary"
				disabled={!access.canWrite}
				onClick={() => setOpen(true)}
			>
				Создать обращение из письма
			</Button>
			{open ? (
				<MailIntakeCopyPanel
					key={JSON.stringify([
						...context.key,
						access.scopeKey,
						messageId
					])}
					access={access}
					messageId={messageId}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	)
}

const MailIntakeCopyPanel = ({
	access,
	messageId,
	onClose
}: {
	access: IntakeAccess
	messageId: string
	onClose: () => void
}) => {
	const context = useMailContext()
	const client = useQueryClient()
	const [created, setCreated] = useState<MailIntakeCreated | null>(null)
	const initialized = useRef(false)
	const recovery = useRef(false)
	const form = useForm<Draft>({
		defaultValues: {
			title: '',
			name: '',
			email: '',
			message: '',
			copyConfirmed: false
		}
	})
	const preview = useQuery({
		queryKey: [
			'crm-intake-mail-preview',
			...context.key,
			access.scopeKey,
			messageId
		],
		enabled: access.canRead && !!access.session,
		queryFn: () =>
			getMailIntakePreview(
				access.session!.accessToken,
				access.workspaceId,
				messageId
			),
		retry: false,
		gcTime: 0,
		staleTime: 0,
		refetchOnWindowFocus: false
	})
	useEffect(() => {
		if (!preview.data || initialized.current) return
		initialized.current = true
		form.reset({
			title: preview.data.draft.title,
			name: preview.data.draft.name,
			email: preview.data.draft.email || '',
			message: preview.data.draft.message || '',
			copyConfirmed: false
		})
	}, [form, preview.data])
	const command = useMemoryCommand<MailIntakeCreate, MailIntakeCreated>(
		{
			owner: commandOwner(access.session?.userId, access.revision),
			workspaceId: access.workspaceId,
			view: access.scopeKey
		},
		`intake:mail-copy:${messageId}`,
		access.canRead && access.online,
		async () => {
			if (!recovery.current) return access.authorize('intake:write')
			const fresh = await access.permissions.refetch()
			if (fresh.error) throw fresh.error
			if (
				!context.current() ||
				!access.session ||
				fresh.data?.subject !== access.session.userId ||
				!fresh.data.permissions.includes('intake:read')
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Доступ к обращениям не подтверждён.'
				)
			return access.session.accessToken
		},
		createMailIntake,
		result => {
			if (!context.current()) return
			setCreated(result)
			form.reset(form.getValues())
			void client.invalidateQueries({
				queryKey: ['crm-inbox', access.workspaceId]
			})
		},
		async (token, saved) => {
			const receipt = await getMailIntakeCommand(
				token,
				saved.workspaceId,
				saved.commandId
			)
			if (receipt.status === 'COMMITTED' && receipt.entryId)
				return {
					schemaVersion: 1,
					sourceKind: 'MAIL',
					workspaceId: saved.workspaceId,
					entryId: receipt.entryId
				}
			if (!access.canWrite)
				throw new AuthenticatedApiError(
					'forbidden',
					'Команда ещё не выполнена. Создание недоступно в текущем режиме пространства.'
				)
			return createMailIntake(token, saved)
		}
	)
	const draftGuard = useDirtyForm({
		dirty: !created && (form.formState.isDirty || command.locked),
		label: 'Обращение из письма'
	})
	const editable =
		access.canWrite &&
		!command.locked &&
		!created &&
		!preview.isError &&
		!preview.isFetching
	const submit = form.handleSubmit(draft => {
		if (!editable || !preview.data || !draft.copyConfirmed) return
		void command.execute(() => ({
			schemaVersion: 1,
			workspaceId: access.workspaceId,
			commandId: crypto.randomUUID(),
			messageId,
			sourceHash: preview.data!.source.sourceHash,
			title: draft.title,
			name: draft.name,
			phone: null,
			email: draft.email.trim() || null,
			message: draft.message.trim() || null,
			teamId: null,
			copyConfirmed: true
		}))
	})
	return (
		<Drawer
			isOpen
			onClose={onClose}
			dirtyFormIds={[draftGuard.id]}
			title="Обращение из письма"
			description="Проверьте и измените поля перед созданием обращения."
		>
			{created ? (
				<div className={styles.form}>
					<p role="status">
						Обращение создано. Повторное копирование этого письма вернёт то
						же обращение.
					</p>
					<Link
						href={`/inbox?workspaceId=${encodeURIComponent(access.workspaceId)}&entry=${created.entryId}`}
					>
						Открыть обращение
					</Link>
					<Button onClick={onClose}>Закрыть</Button>
				</div>
			) : (
				<div className={styles.form}>
					<p className={styles.notice}>
						Будет создана отдельная копия выбранных полей. Она доступна
						сотрудникам по правам раздела «Входящие». Доступ к исходному
						письму остаётся по правам почтового ящика. Вложения и скрытая
						копия не переносятся.
					</p>
					{!preview.data ? (
						<ScreenState
							compact
							variant={preview.isError ? 'error' : 'loading'}
							title={
								preview.isError
									? 'Не удалось получить предварительный просмотр'
									: 'Загружаем поля письма…'
							}
							action={
								preview.isError ? (
									<Button
										variant="secondary"
										onClick={() => void preview.refetch()}
									>
										Повторить
									</Button>
								) : undefined
							}
						/>
					) : (
						<>
							{preview.data.textTruncated ||
							preview.data.bodyStatus !== 'COMPLETE' ? (
								<p role="status" className={styles.notice}>
									{preview.data.textTruncated
										? 'В обращение предложено не более 5000 символов письма. Проверьте полноту текста.'
										: 'Полный текст письма недоступен. Заполните сообщение вручную.'}
								</p>
							) : null}
							<form
								className={styles.form}
								onSubmit={event => {
									recovery.current = false
									void submit(event)
								}}
							>
								<TextField
									label="Тема обращения"
									disabled={!editable}
									maxLength={200}
									error={form.formState.errors.title?.message}
									{...form.register('title', {
										validate: value => !!value.trim() || 'Укажите тему'
									})}
								/>
								<div className={styles.row}>
									<TextField
										label="Имя отправителя"
										disabled={!editable}
										maxLength={200}
										error={form.formState.errors.name?.message}
										{...form.register('name', {
											validate: value => !!value.trim() || 'Укажите имя'
										})}
									/>
									<TextField
										label="Email"
										type="email"
										disabled={!editable}
										maxLength={254}
										{...form.register('email')}
									/>
								</div>
								<TextareaField
									label="Текст обращения"
									disabled={!editable}
									maxLength={5000}
									rows={10}
									{...form.register('message')}
								/>
								<label>
									<input
										type="checkbox"
										disabled={!editable}
										{...form.register('copyConfirmed', {
											required: 'Подтвердите создание отдельной копии'
										})}
									/>{' '}
									Я проверил поля и подтверждаю создание отдельной копии с
									доступом по правам «Входящих».
								</label>
								{form.formState.errors.copyConfirmed ? (
									<p role="alert">
										{form.formState.errors.copyConfirmed.message}
									</p>
								) : null}
								<Button type="submit" disabled={!editable}>
									{command.running ? 'Создаём…' : 'Создать обращение'}
								</Button>
							</form>
						</>
					)}
					{command.error ? (
						<div className={styles.error} role="alert">
							<p>{command.error.message}</p>
							{command.uncertain ? (
								<p>
									Результат пока не подтверждён. Проверка использует
									сохранённую команду и не создаёт дубль.
								</p>
							) : null}
						</div>
					) : null}
					{command.uncertain ? (
						<Button
							variant="secondary"
							disabled={command.running || !access.canRead}
							onClick={() => {
								recovery.current = true
								void command.recover()
							}}
						>
							Проверить результат
						</Button>
					) : null}
					{!access.canWrite ? (
						<p role="status">
							Создание обращения сейчас недоступно. Проверьте подключение,
							права и режим пространства.
						</p>
					) : null}
				</div>
			)}
		</Drawer>
	)
}
