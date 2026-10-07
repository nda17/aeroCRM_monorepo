'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMailIntakeSource } from '@/entities/intake/api/mail-intake.api'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { Button, Drawer } from '@/shared/ui'
import { MailMessageReader } from '@/features/manage-mail/ui/MailMessageReader'
import type { IntakeAccess } from '../model/use-intake-access'
import styles from './IntakeForms.module.scss'

export const MailIntakeSourceControl = (props: {
	access: IntakeAccess
	entryId: string
}) => (
	<MailSourcePanel
		key={JSON.stringify([
			props.access.workspaceId,
			props.access.session?.userId,
			props.access.revision,
			props.access.scopeKey,
			props.entryId
		])}
		{...props}
	/>
)

const MailSourcePanel = ({
	access,
	entryId
}: {
	access: IntakeAccess
	entryId: string
}) => {
	const [open, setOpen] = useState(false)
	const source = useQuery({
		queryKey: [
			'crm-intake-mail-source',
			access.workspaceId,
			access.session?.userId,
			access.revision,
			access.scopeKey,
			entryId
		],
		enabled: access.canRead && !!access.session,
		queryFn: () =>
			getMailIntakeSource(
				access.session!.accessToken,
				access.workspaceId,
				entryId
			),
		gcTime: 0,
		staleTime: 0,
		retry: false,
		refetchOnWindowFocus: false
	})
	if (
		!access.canRead ||
		(source.error instanceof AuthenticatedApiError &&
			source.error.kind === 'notFound')
	)
		return null
	if (source.isError)
		return (
			<div className={styles.notice} role="status">
				<p>Не удалось проверить исходное письмо.</p>
				<Button variant="secondary" onClick={() => void source.refetch()}>
					Повторить проверку
				</Button>
			</div>
		)
	if (!source.data || source.isFetching) return null
	return (
		<div className={styles.notice}>
			<p>
				Источник: письмо. В обращении хранится отдельная копия выбранных
				полей.
			</p>
			{source.data.canOpen && source.data.messageId ? (
				<Button variant="secondary" onClick={() => setOpen(true)}>
					Открыть исходное письмо
				</Button>
			) : (
				<p>
					Исходное письмо недоступно по текущим правам или больше
					недоступно в почтовом ящике.
				</p>
			)}
			{open && source.data.canOpen && source.data.messageId ? (
				<Drawer
					isOpen
					onClose={() => setOpen(false)}
					title="Исходное письмо"
					description="Доступ проверяется по правам почтового ящика."
				>
					<MailMessageReader
						key={`${access.workspaceId}:${source.data.messageId}`}
						id={source.data.messageId}
					/>
				</Drawer>
			) : null}
		</div>
	)
}
