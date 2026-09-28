'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
	Button,
	Drawer,
	SelectField,
	TextField,
	ScreenState
} from '@/shared/ui'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import {
	getMailConnection,
	mailCommand
} from '@/entities/mail/api/mail.api'
import {
	parseMailMailboxResult,
	type MailMailbox,
	type MailConnectionSettings
} from '@/entities/mail/model/mail.contract'
import {
	newMailCommand,
	isMailAccessDenied,
	useMailCommand,
	useMailContext
} from '../model/use-mail-context'
import { MailCommandNotice } from './MailCommandNotice'
import styles from './Mail.module.scss'

const initial = {
	kind: 'PERSONAL',
	address: '',
	displayName: '',
	password: '',
	smtpPassword: '',
	imapHost: '',
	imapPort: '993',
	imapSecurity: 'TLS',
	imapUsername: '',
	smtpHost: '',
	smtpPort: '465',
	smtpSecurity: 'TLS',
	smtpUsername: ''
}
type ConnectMailboxProps = {
	mailbox?: MailMailbox
	onClose: () => void
	onConnected: () => void
}
export const ConnectMailbox = (props: ConnectMailboxProps) => {
	const context = useMailContext()
	const settings = useQuery({
		queryKey: ['mail-connection', ...context.key, props.mailbox?.id],
		enabled: !!context.session && !!props.mailbox,
		queryFn: () =>
			getMailConnection(
				context.session!.accessToken,
				context.workspace.workspaceId,
				props.mailbox!.id
			),
		gcTime: 0,
		retry: false
	})
	if (!props.mailbox) return <ConnectionForm {...props} />
	if (settings.data && !isMailAccessDenied(settings.error))
		return (
			<ConnectionForm
				{...props}
				settings={settings.data.item}
				stale={settings.isError}
				retry={() => void settings.refetch()}
			/>
		)
	return (
		<Drawer isOpen title="Переподключить ящик" onClose={props.onClose}>
			<ScreenState
				variant={settings.isError ? 'error' : 'loading'}
				title={
					settings.isError
						? 'Настройки подключения недоступны'
						: 'Загружаем настройки…'
				}
				action={
					settings.isError ? (
						<Button onClick={() => void settings.refetch()}>
							Повторить
						</Button>
					) : undefined
				}
			/>
		</Drawer>
	)
}
const ConnectionForm = ({
	mailbox,
	settings,
	stale = false,
	retry,
	onClose,
	onConnected
}: ConnectMailboxProps & {
	settings?: MailConnectionSettings
	stale?: boolean
	retry?: () => void
}) => {
	const context = useMailContext()
	const [baseline] = useState(() =>
		mailbox
			? {
					...initial,
					kind: mailbox.kind,
					address: mailbox.address,
					displayName: mailbox.displayName,
					...(settings
						? {
								imapHost: settings.imap.host,
								imapPort: String(settings.imap.port),
								imapSecurity: settings.imap.security,
								imapUsername: settings.imap.username,
								smtpHost: settings.smtp.host,
								smtpPort: String(settings.smtp.port),
								smtpSecurity: settings.smtp.security,
								smtpUsername: settings.smtp.username
							}
						: {})
				}
			: initial
	)
	const [values, setValues] = useState(baseline)
	const [separatePassword, setSeparatePassword] = useState(false)
	const [saved, setSaved] = useState(false)
	const form = useDirtyForm({
		dirty: !saved && JSON.stringify(values) !== JSON.stringify(baseline),
		label: 'Подключение почты'
	})
	const set = (key: keyof typeof initial, value: string) =>
		setValues(previous => ({ ...previous, [key]: value }))
	const build = () => ({
		...newMailCommand(context.workspace.workspaceId),
		...(mailbox
			? { expectedVersion: mailbox.version }
			: {
					kind: values.kind,
					address: values.address.trim(),
					displayName: values.displayName.trim() || values.address.trim()
				}),
		imap: {
			host: values.imapHost.trim(),
			port: Number(values.imapPort),
			security: values.imapSecurity,
			username: values.imapUsername.trim() || values.address.trim()
		},
		smtp: {
			host: values.smtpHost.trim(),
			port: Number(values.smtpPort),
			security: values.smtpSecurity,
			username: values.smtpUsername.trim() || values.address.trim()
		},
		password: values.password,
		smtpPassword: separatePassword ? values.smtpPassword : null
	})
	const command = useMailCommand(
		context,
		mailbox ? `mail-reconnect:${mailbox.id}` : 'mail-connect',
		'mail:manage',
		(token, data: ReturnType<typeof build>) =>
			mailCommand(
				token,
				mailbox ? `/mailboxes/${mailbox.id}/connection` : '/connections',
				data,
				parseMailMailboxResult,
				mailbox ? 'PUT' : 'POST'
			),
		() => {
			setSaved(true)
			setValues(initial)
			form.markClean()
			onConnected()
		}
	)
	return (
		<Drawer
			isOpen
			title={
				mailbox ? `Переподключить ${mailbox.address}` : 'Подключить почту'
			}
			onClose={onClose}
			dirtyFormIds={[form.id]}
		>
			<form
				className={styles.stack}
				onSubmit={event => {
					event.preventDefault()
					if (!stale) void command.execute(build)
				}}
			>
				<p>
					Укажите настройки почтового клиента. Соединение будет проверено
					без отправки письма.{' '}
					{mailbox
						? 'История переписки и выданные права сохранятся.'
						: 'Импорт начнётся после выбора папок.'}
				</p>
				{stale ? (
					<div role="alert">
						Не удалось обновить настройки. Изменения сохранены в форме.{' '}
						<Button onClick={retry}>Повторить</Button>
					</div>
				) : null}
				<fieldset
					disabled={command.locked || stale}
					className={styles.fieldset}
				>
					<div className={styles.stack}>
						<SelectField
							label="Кому принадлежит ящик"
							value={values.kind}
							disabled={!!mailbox}
							onChange={event => set('kind', event.target.value)}
						>
							<option value="PERSONAL">Мой рабочий ящик</option>
							{context.capabilities.data?.canCreateShared ||
							mailbox?.kind === 'SHARED' ? (
								<option value="SHARED">Общий ящик команды</option>
							) : null}
						</SelectField>
						<TextField
							label="Адрес почты"
							type="email"
							maxLength={254}
							required
							autoComplete="off"
							value={values.address}
							readOnly={!!mailbox}
							onChange={event => set('address', event.target.value)}
						/>
						<TextField
							label="Название в CRM"
							maxLength={200}
							value={values.displayName}
							readOnly={!!mailbox}
							onChange={event => set('displayName', event.target.value)}
						/>
						<div className={styles.grid}>
							<fieldset className={styles.fieldset}>
								<legend>Входящая почта — IMAP</legend>
								<div className={styles.stack}>
									<TextField
										label="Сервер IMAP"
										required
										maxLength={253}
										placeholder="imap.example.ru"
										value={values.imapHost}
										onChange={event => set('imapHost', event.target.value)}
									/>
									<SelectField
										label="Защита соединения IMAP"
										value={values.imapSecurity}
										onChange={event =>
											setValues(previous => ({
												...previous,
												imapSecurity: event.target.value,
												imapPort:
													event.target.value === 'TLS' ? '993' : '143'
											}))
										}
									>
										<option value="TLS">TLS — порт 993</option>
										<option value="STARTTLS">STARTTLS — порт 143</option>
									</SelectField>
									<TextField
										label="Логин IMAP"
										maxLength={254}
										placeholder="По умолчанию — адрес почты"
										autoComplete="off"
										value={values.imapUsername}
										onChange={event =>
											set('imapUsername', event.target.value)
										}
									/>
								</div>
							</fieldset>
							<fieldset className={styles.fieldset}>
								<legend>Исходящая почта — SMTP</legend>
								<div className={styles.stack}>
									<TextField
										label="Сервер SMTP"
										required
										maxLength={253}
										placeholder="smtp.example.ru"
										value={values.smtpHost}
										onChange={event => set('smtpHost', event.target.value)}
									/>
									<SelectField
										label="Защита соединения SMTP"
										value={values.smtpSecurity}
										onChange={event =>
											setValues(previous => ({
												...previous,
												smtpSecurity: event.target.value,
												smtpPort:
													event.target.value === 'TLS' ? '465' : '587'
											}))
										}
									>
										<option value="TLS">TLS</option>
										<option value="STARTTLS">STARTTLS</option>
									</SelectField>
									<SelectField
										label="Порт SMTP"
										value={values.smtpPort}
										onChange={event => set('smtpPort', event.target.value)}
									>
										{(values.smtpSecurity === 'TLS'
											? ['465']
											: ['587', '25', '2525']
										).map(port => (
											<option key={port} value={port}>
												{port}
											</option>
										))}
									</SelectField>
									<TextField
										label="Логин SMTP"
										maxLength={254}
										placeholder="По умолчанию — адрес почты"
										autoComplete="off"
										value={values.smtpUsername}
										onChange={event =>
											set('smtpUsername', event.target.value)
										}
									/>
								</div>
							</fieldset>
						</div>
						<TextField
							label="Пароль приложения или почтового ящика"
							type="password"
							required
							maxLength={1024}
							autoComplete="new-password"
							value={values.password}
							onChange={event => set('password', event.target.value)}
							hint="Используйте пароль приложения, если он предусмотрен вашим почтовым сервисом."
						/>
						<label className={styles.check}>
							<input
								type="checkbox"
								checked={separatePassword}
								onChange={event => {
									setSeparatePassword(event.target.checked)
									if (!event.target.checked) set('smtpPassword', '')
								}}
							/>
							Для SMTP нужен другой пароль
						</label>
						{separatePassword ? (
							<TextField
								label="Пароль SMTP"
								type="password"
								required
								maxLength={1024}
								autoComplete="new-password"
								value={values.smtpPassword}
								onChange={event => set('smtpPassword', event.target.value)}
							/>
						) : null}
					</div>
				</fieldset>
				<MailCommandNotice command={command} />
				<div className={styles.actions}>
					<Button
						type="submit"
						disabled={!command.enabled || command.locked || stale}
					>
						{mailbox
							? 'Проверить и переподключить'
							: 'Проверить и подключить'}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={command.running}
						onClick={() => form.confirmDiscard(onClose)}
					>
						Отмена
					</Button>
				</div>
			</form>
		</Drawer>
	)
}
