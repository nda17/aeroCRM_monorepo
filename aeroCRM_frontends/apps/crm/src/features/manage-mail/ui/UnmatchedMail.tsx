'use client'

import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
	Button,
	Drawer,
	SelectField,
	TextField,
	ScreenState
} from '@/shared/ui'
import {
	useDirtyForm,
	useDirtyFormGuard,
	DirtyFormScope
} from '@/shared/lib/dirty-form'
import { listCustomers } from '@/entities/customer'
import {
	listUnmatchedMail,
	getUnmatchedMailMessage,
	mailCommand
} from '@/entities/mail/api/mail.api'
import {
	parseMailLinkResult,
	type MailMailbox
} from '@/entities/mail/model/mail.contract'
import {
	newMailCommand,
	isMailAccessDenied,
	useMailCommand,
	useMailContext
} from '../model/use-mail-context'
import { MailMessageReader } from './MailMessageReader'
import { MailCommandNotice } from './MailCommandNotice'
import styles from './Mail.module.scss'

export const UnmatchedMail = ({
	mailbox,
	onClose
}: {
	mailbox: MailMailbox
	onClose: () => void
}) => {
	const context = useMailContext()
	const guard = useDirtyFormGuard()
	const linkScopeId = useId()
	const [cursor, setCursor] = useState<string | undefined>()
	const [selected, setSelected] = useState<string | null>(null)
	const readable =
		context.capabilities.data?.enabled === true &&
		context.capabilities.data.mailPermissions.includes('mail:read') &&
		mailbox.permissions.includes('read')
	const rows = useQuery({
		queryKey: ['mail-unmatched', ...context.key, mailbox.id, cursor],
		enabled:
			readable && !!context.session && !context.capabilities.isError,
		queryFn: () =>
			listUnmatchedMail(
				context.session!.accessToken,
				context.workspace.workspaceId,
				mailbox.id,
				cursor
			),
		gcTime: 0,
		retry: false,
		staleTime: 0,
		refetchInterval: query =>
			readable && !context.capabilities.isError && !query.state.error
				? 5000
				: false
	})
	if (
		!readable ||
		isMailAccessDenied(context.capabilities.error) ||
		isMailAccessDenied(rows.error)
	)
		return null
	return (
		<Drawer
			isOpen
			title={`Непривязанные письма: ${mailbox.address}`}
			onClose={onClose}
		>
			<div className={styles.stack}>
				<p>Выберите письмо и контакт, к которому относится переписка.</p>
				{rows.isError || !rows.data ? (
					<ScreenState
						compact
						variant={rows.isError ? 'error' : 'loading'}
						title={
							rows.isError ? 'Письма недоступны' : 'Загружаем письма…'
						}
						action={
							rows.isError ? (
								<Button onClick={() => void rows.refetch()}>
									Повторить
								</Button>
							) : undefined
						}
					/>
				) : (
					<>
						{!rows.data.items.length ? (
							<p>Все доступные письма привязаны.</p>
						) : (
							<ul className={styles.list}>
								{rows.data.items.map(message => (
									<li key={message.id}>
										<Button
											variant="secondary"
											onClick={() =>
												guard.confirmDiscard(
													() => setSelected(message.id),
													[linkScopeId]
												)
											}
										>
											{message.subject || 'Без темы'}
										</Button>
									</li>
								))}
							</ul>
						)}
						<div className={styles.actions}>
							{cursor ? (
								<Button
									variant="secondary"
									onClick={() => setCursor(undefined)}
								>
									К началу
								</Button>
							) : null}
							{rows.data.nextCursor ? (
								<Button
									variant="secondary"
									onClick={() => setCursor(rows.data!.nextCursor!)}
								>
									Далее
								</Button>
							) : null}
						</div>
					</>
				)}
				{selected ? (
					<DirtyFormScope id={linkScopeId}>
						<LinkMessage
							key={selected}
							id={selected}
							mailboxId={mailbox.id}
							onLinked={() => {
								setSelected(null)
								void rows.refetch()
							}}
						/>
					</DirtyFormScope>
				) : null}
			</div>
		</Drawer>
	)
}
const LinkMessage = ({
	id,
	mailboxId,
	onLinked
}: {
	id: string
	mailboxId: string
	onLinked: () => void
}) => {
	const context = useMailContext()
	const client = useQueryClient()
	const [search, setSearch] = useState('')
	const [contactId, setContactId] = useState('')
	const [externalEmail, setExternalEmail] = useState('')
	const form = useDirtyForm({
		dirty: !!contactId || !!externalEmail,
		label: 'Привязка письма'
	})
	const message = useQuery({
		queryKey: ['mail-unmatched-message', ...context.key, id],
		enabled: !!context.session,
		queryFn: () =>
			getUnmatchedMailMessage(
				context.session!.accessToken,
				context.workspace.workspaceId,
				mailboxId,
				id
			),
		gcTime: 0,
		staleTime: 0,
		retry: false
	})
	const contacts = useQuery({
		queryKey: ['mail-link-contacts', ...context.key, search],
		enabled: !!context.session,
		queryFn: () =>
			listCustomers(
				context.session!.accessToken,
				'contacts',
				context.workspace.workspaceId,
				1,
				25,
				search
			),
		gcTime: 0,
		retry: false
	})
	const link = message.data?.item.links.find(
		value =>
			value.externalEmail === externalEmail && value.state !== 'LINKED'
	)
	const build = () => ({
		...newMailCommand(context.workspace.workspaceId),
		expectedVersion: link!.version,
		externalEmail,
		contactId
	})
	const command = useMailCommand(
		context,
		`mail-link:${id}`,
		'mail:manage',
		(token, data: ReturnType<typeof build>) =>
			mailCommand(
				token,
				`/messages/${id}/link`,
				data,
				parseMailLinkResult
			),
		() => {
			form.markClean()
			setContactId('')
			setExternalEmail('')
			void client.invalidateQueries({
				queryKey: ['mail-contact-messages', context.workspace.workspaceId]
			})
			onLinked()
		}
	)
	return (
		<div className={styles.panel}>
			<MailMessageReader id={id} unmatchedMailboxId={mailboxId} />
			<form
				className={styles.stack}
				onSubmit={event => {
					event.preventDefault()
					if (link && contactId) void command.execute(build)
				}}
			>
				<SelectField
					label="Адрес из письма"
					value={externalEmail}
					disabled={command.locked || message.isError}
					required
					onChange={event => setExternalEmail(event.target.value)}
				>
					<option value="">Выберите адрес</option>
					{message.data?.item.links
						.filter(value => value.state !== 'LINKED')
						.map(value => (
							<option
								key={value.externalEmail}
								value={value.externalEmail}
							>
								{value.externalEmail}
							</option>
						))}
				</SelectField>
				<TextField
					label="Найти контакт"
					value={search}
					maxLength={200}
					disabled={command.locked}
					onChange={event => {
						setSearch(event.target.value)
						setContactId('')
					}}
				/>
				<SelectField
					label="Контакт"
					value={contactId}
					required
					disabled={
						command.locked || contacts.isFetching || contacts.isError
					}
					onChange={event => setContactId(event.target.value)}
				>
					<option value="">Выберите контакт</option>
					{contacts.data?.items.map(contact => (
						<option key={contact.id} value={contact.id}>
							{contact.name}
						</option>
					))}
				</SelectField>
				<MailCommandNotice command={command} />
				<Button
					type="submit"
					disabled={
						!command.enabled ||
						command.locked ||
						!link ||
						!contactId ||
						message.isError ||
						contacts.isError
					}
				>
					Привязать к контакту
				</Button>
			</form>
		</div>
	)
}
