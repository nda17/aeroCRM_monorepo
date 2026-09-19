'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useWorkdaySession } from '@/entities/crm-workday'
import { listInbox } from '@/entities/intake'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { Button } from '@/shared/ui'
import styles from './MyDayScreen.module.scss'

// Intake owns visibility and counts. Task-period/assignee filters must not be
// represented as Intake filters: the existing Inbox contract has neither.
export const WorkdayInboxSummary = ({
	disabled = false
}: {
	disabled?: boolean
}) => {
	const context = useWorkdaySession()
	const allowed =
		context.canRead &&
		context.permissions.data?.permissions.includes('intake:read') === true
	const query = useQuery({
		queryKey: ['crm-inbox', ...context.key, 'my-day-new'],
		enabled: allowed,
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: 'always',
		queryFn: async () => {
			if (!allowed || !context.current() || !context.session)
				throw invalidContractError()
			const page = await listInbox(
				context.session.accessToken,
				context.workspace.workspaceId,
				1,
				1,
				'',
				'NEW'
			)
			if (
				!context.current() ||
				page.items.some(entry => entry.status !== 'NEW')
			)
				throw invalidContractError()
			return page
		}
	})
	if (!context.permissions.data?.permissions.includes('intake:read'))
		return null
	const content = (
		<>
			<strong>Новые обращения</strong>
			<span className={styles.hint}>
				Все доступные вам обращения. Не зависят от периода задач.
			</span>
		</>
	)
	return (
		<section
			className={styles.inboxSummary}
			aria-label="Новые обращения"
			aria-busy={query.isFetching || !allowed}
		>
			{allowed && !disabled ? (
				<Link
					className={styles.inboxLink}
					href="/inbox"
					onClick={() => toast('Открываем входящие')}
				>
					{content}
				</Link>
			) : (
				<div className={styles.copy}>{content}</div>
			)}
			{query.isError ? (
				<div className={styles.copy} role="alert">
					<span>Счётчик входящих временно недоступен</span>
					<Button
						variant="secondary"
						size="sm"
						disabled={!allowed || disabled}
						onClick={() => void query.refetch()}
					>
						Повторить
					</Button>
				</div>
			) : (
				<strong
					className={styles.summaryValue}
					aria-label="Количество новых обращений"
				>
					{allowed ? (query.data?.total ?? '—') : '—'}
				</strong>
			)}
		</section>
	)
}
