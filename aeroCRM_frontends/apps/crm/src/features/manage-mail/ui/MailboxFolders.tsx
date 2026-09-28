'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Drawer, SelectField, ScreenState } from '@/shared/ui'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import { listMailFolders, mailCommand } from '@/entities/mail/api/mail.api'
import {
	parseMailMailboxResult,
	type MailMailbox,
	type MailFolder
} from '@/entities/mail/model/mail.contract'
import {
	newMailCommand,
	isMailAccessDenied,
	useMailCommand,
	useMailContext
} from '../model/use-mail-context'
import { MailCommandNotice } from './MailCommandNotice'
import styles from './Mail.module.scss'

export const MailboxFolders = (props: {
	mailbox: MailMailbox
	onClose: () => void
	onSaved: () => void
}) => {
	const context = useMailContext()
	const folders = useQuery({
		queryKey: ['mail-folders', ...context.key, props.mailbox.id],
		queryFn: () =>
			listMailFolders(
				context.session!.accessToken,
				context.workspace.workspaceId,
				props.mailbox.id
			),
		enabled: !!context.session,
		retry: false,
		gcTime: 0,
		staleTime: 0
	})
	return folders.data && !isMailAccessDenied(folders.error) ? (
		<FolderForm
			{...props}
			folders={folders.data.items}
			stale={folders.isError}
			retry={() => void folders.refetch()}
		/>
	) : (
		<Drawer isOpen title="Папки почтового ящика" onClose={props.onClose}>
			<ScreenState
				variant={folders.isError ? 'error' : 'loading'}
				title={
					folders.isError
						? 'Не удалось получить папки'
						: 'Загружаем папки…'
				}
				action={
					folders.isError ? (
						<Button onClick={() => void folders.refetch()}>
							Повторить
						</Button>
					) : undefined
				}
			/>
		</Drawer>
	)
}
const FolderForm = ({
	mailbox,
	folders,
	stale,
	retry,
	onClose,
	onSaved
}: {
	mailbox: MailMailbox
	folders: MailFolder[]
	stale: boolean
	retry: () => void
	onClose: () => void
	onSaved: () => void
}) => {
	const context = useMailContext()
	const [baseline] = useState(() => ({
		inbox:
			folders.find(folder => folder.selected && folder.kind === 'INBOX')
				?.path ?? '',
		sent:
			folders.find(folder => folder.selected && folder.kind === 'SENT')
				?.path ?? ''
	}))
	const [selected, setSelected] = useState(baseline)
	const [saved, setSaved] = useState(false)
	const form = useDirtyForm({
		dirty: !saved && JSON.stringify(selected) !== JSON.stringify(baseline),
		label: 'Папки почты'
	})
	const build = () => ({
		...newMailCommand(context.workspace.workspaceId),
		expectedVersion: mailbox.version,
		folders: [
			...(selected.inbox ? [{ path: selected.inbox, kind: 'INBOX' }] : []),
			...(selected.sent ? [{ path: selected.sent, kind: 'SENT' }] : [])
		]
	})
	const command = useMailCommand(
		context,
		`mail-folders:${mailbox.id}`,
		'mail:manage',
		(token, data: ReturnType<typeof build>) =>
			mailCommand(
				token,
				`/mailboxes/${mailbox.id}/folders`,
				data,
				parseMailMailboxResult,
				'PUT'
			),
		() => {
			setSaved(true)
			form.markClean()
			onSaved()
		}
	)
	const duplicate = !!selected.inbox && selected.inbox === selected.sent
	return (
		<Drawer
			isOpen
			title={`Папки: ${mailbox.address}`}
			onClose={onClose}
			dirtyFormIds={[form.id]}
		>
			<form
				className={styles.stack}
				onSubmit={event => {
					event.preventDefault()
					if (!duplicate && !stale) void command.execute(build)
				}}
			>
				<p>
					Выберите папки для переписки с клиентами. Будут загружены письма
					за последние 90 дней, затем — новые письма. Остальные папки не
					импортируются.
				</p>
				{stale ? (
					<div role="alert">
						Не удалось обновить папки. Изменения сохранены в форме.{' '}
						<Button onClick={retry}>Повторить</Button>
					</div>
				) : null}
				{(['inbox', 'sent'] as const).map(kind => (
					<SelectField
						key={kind}
						label={kind === 'inbox' ? 'Входящие' : 'Отправленные'}
						disabled={command.locked || stale}
						value={selected[kind]}
						onChange={event =>
							setSelected(previous => ({
								...previous,
								[kind]: event.target.value
							}))
						}
					>
						<option value="">Не импортировать</option>
						{folders.map(folder => (
							<option key={folder.path} value={folder.path}>
								{folder.name}
							</option>
						))}
					</SelectField>
				))}
				{duplicate ? (
					<p role="alert">
						Для входящих и отправленных выберите разные папки.
					</p>
				) : null}
				<MailCommandNotice command={command} />
				<Button
					type="submit"
					disabled={
						!command.enabled ||
						command.locked ||
						stale ||
						duplicate ||
						(!selected.inbox && !selected.sent)
					}
				>
					Сохранить и начать импорт
				</Button>
			</form>
		</Drawer>
	)
}
