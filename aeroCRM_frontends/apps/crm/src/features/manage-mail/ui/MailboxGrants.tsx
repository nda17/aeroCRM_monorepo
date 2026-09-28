'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listTeamRecords, type CrmMemberRow } from '@/entities/crm-team'
import { listMailGrants, mailCommand } from '@/entities/mail/api/mail.api'
import {
	parseMailMailboxResult,
	type MailGrant,
	type MailMailbox
} from '@/entities/mail/model/mail.contract'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import { Button, Drawer, ScreenState } from '@/shared/ui'
import {
	newMailCommand,
	useMailCommand,
	useMailContext
} from '../model/use-mail-context'
import { MailCommandNotice } from './MailCommandNotice'
import styles from './Mail.module.scss'

export const MailboxGrants = (props: {
	mailbox: MailMailbox
	onClose: () => void
	onSaved: () => void
}) => {
	const context = useMailContext()
	const grants = useQuery({
		queryKey: ['mail-grants', ...context.key, props.mailbox.id],
		enabled: !!context.session,
		queryFn: () =>
			listMailGrants(
				context.session!.accessToken,
				context.workspace.workspaceId,
				props.mailbox.id
			),
		gcTime: 0,
		retry: false
	})
	const denied =
		grants.error instanceof AuthenticatedApiError &&
		['unauthorized', 'forbidden', 'notFound'].includes(grants.error.kind)
	return grants.data && !denied ? (
		<GrantForm
			{...props}
			initial={grants.data.items}
			stale={grants.isError}
			retry={() => void grants.refetch()}
		/>
	) : (
		<Drawer isOpen title="Доступ к общему ящику" onClose={props.onClose}>
			<ScreenState
				variant={grants.isError ? 'error' : 'loading'}
				title={
					grants.isError ? 'Доступ к ящику недоступен' : 'Загружаем права…'
				}
				action={
					grants.isError ? (
						<Button onClick={() => void grants.refetch()}>
							Повторить
						</Button>
					) : undefined
				}
			/>
		</Drawer>
	)
}

const GrantForm = ({
	mailbox,
	initial,
	stale,
	retry,
	onClose,
	onSaved
}: {
	mailbox: MailMailbox
	initial: MailGrant[]
	stale: boolean
	retry: () => void
	onClose: () => void
	onSaved: () => void
}) => {
	const context = useMailContext()
	const [baseline] = useState(initial)
	const [grants, setGrants] = useState(initial)
	const [page, setPage] = useState(1)
	const [saved, setSaved] = useState(false)
	const form = useDirtyForm({
		dirty: !saved && JSON.stringify(grants) !== JSON.stringify(baseline),
		label: 'Права на почту'
	})
	const members = useQuery({
		queryKey: ['mail-grant-members', ...context.key, page],
		enabled: !!context.session,
		queryFn: () =>
			listTeamRecords(
				context.session!.accessToken,
				context.workspace.workspaceId,
				'members',
				page,
				50
			),
		gcTime: 0,
		retry: false
	})
	const build = () => ({
		...newMailCommand(context.workspace.workspaceId),
		expectedVersion: mailbox.version,
		grants: grants.filter(
			grant => grant.read || grant.send || grant.manage
		)
	})
	const command = useMailCommand(
		context,
		`mail-grants:${mailbox.id}`,
		'mail:manage',
		(token, data: ReturnType<typeof build>) =>
			mailCommand(
				token,
				`/mailboxes/${mailbox.id}/grants`,
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
	const update = (
		member: CrmMemberRow,
		key: 'read' | 'send' | 'manage',
		checked: boolean
	) =>
		setGrants(previous => {
			const grant = previous.find(
				value =>
					value.subject === member.subject &&
					value.membershipId === member.membershipId
			) ?? {
				subject: member.subject,
				membershipId: member.membershipId,
				read: false,
				send: false,
				manage: false
			}
			const next = { ...grant, [key]: checked }
			if ((key === 'send' || key === 'manage') && checked) next.read = true
			if (key === 'read' && !checked) {
				next.send = false
				next.manage = false
			}
			return [
				...previous.filter(
					value =>
						value.subject !== member.subject ||
						value.membershipId !== member.membershipId
				),
				next
			]
		})
	return (
		<Drawer
			isOpen
			title={`Доступ: ${mailbox.address}`}
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
					Разрешения ящика действуют вместе с правами сотрудника на
					клиентов. Личная почта других сотрудников здесь недоступна.
				</p>
				{stale ? (
					<div role="alert">
						Не удалось обновить права. Изменения сохранены в форме.{' '}
						<Button variant="secondary" onClick={retry}>
							Повторить
						</Button>
					</div>
				) : null}
				{members.isError || !members.data ? (
					<ScreenState
						compact
						variant={members.isError ? 'error' : 'loading'}
						title={
							members.isError
								? 'Не удалось получить сотрудников'
								: 'Загружаем сотрудников…'
						}
						action={
							members.isError ? (
								<Button onClick={() => void members.refetch()}>
									Повторить
								</Button>
							) : undefined
						}
					/>
				) : (
					<>
						<ul className={styles.list}>
							{members.data.items
								.filter(
									(row): row is CrmMemberRow => row.kind === 'member'
								)
								.map(member => {
									const grant = grants.find(
										value =>
											value.subject === member.subject &&
											value.membershipId === member.membershipId
									)
									return (
										<li key={member.id} className={styles.item}>
											<strong>
												{member.displayName ||
													member.verifiedEmail ||
													'Сотрудник без имени'}
											</strong>
											{member.disabledAt ? (
												<p>Доступ сотрудника отключён</p>
											) : null}
											<div className={styles.actions}>
												{(['read', 'send', 'manage'] as const).map(
													permission => (
														<label
															className={styles.check}
															key={permission}
														>
															<input
																type="checkbox"
																checked={grant?.[permission] ?? false}
																disabled={
																	command.locked ||
																	stale ||
																	!!member.disabledAt
																}
																onChange={event =>
																	update(
																		member,
																		permission,
																		event.target.checked
																	)
																}
															/>
															{
																{
																	read: 'Чтение',
																	send: 'Отправка',
																	manage: 'Настройки'
																}[permission]
															}
														</label>
													)
												)}
											</div>
										</li>
									)
								})}
						</ul>
						<div className={styles.actions}>
							<Button
								variant="secondary"
								disabled={page === 1 || members.isFetching}
								onClick={() => setPage(value => value - 1)}
							>
								Назад
							</Button>
							<span>Страница {page}</span>
							<Button
								variant="secondary"
								disabled={
									page * 50 >= members.data.total || members.isFetching
								}
								onClick={() => setPage(value => value + 1)}
							>
								Далее
							</Button>
						</div>
					</>
				)}
				<MailCommandNotice command={command} />
				<Button
					type="submit"
					disabled={
						!command.enabled ||
						command.locked ||
						stale ||
						members.isError ||
						!members.data
					}
				>
					Сохранить доступ
				</Button>
			</form>
		</Drawer>
	)
}
