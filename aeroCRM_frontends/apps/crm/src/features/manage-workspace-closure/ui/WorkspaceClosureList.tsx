'use client'

import { listWorkspaceClosures } from '@/entities/workspace-closure'
import { useSessionStore } from '@/entities/session'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { Button } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { WorkspaceClosureStatus } from './WorkspaceClosureStatus'
import styles from './WorkspaceClosure.module.scss'

export const WorkspaceClosureList = ({
	onSelect
}: {
	onSelect?: (workspaceId: string) => void
}) => {
	const { session, sessionRevision } = useSessionStore()
	const [selected, setSelected] = useState<string | null>(null)
	const closures = useQuery({
		queryKey: ['crm-workspace-closures', session?.userId, sessionRevision],
		queryFn: async () => {
			const value = await listWorkspaceClosures(
				session!.accessToken,
				session!.userId
			)
			const live = useSessionStore.getState()
			if (
				live.session?.userId !== session?.userId ||
				live.session?.accessToken !== session?.accessToken ||
				live.sessionRevision !== sessionRevision
			)
				throw invalidContractError()
			return value
		},
		enabled: !!session,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	if (!session) return null
	const selectedClosure = closures.data?.items.find(
		item => item.id === selected
	)
	return (
		<section
			className={styles.card}
			aria-label="Закрытые рабочие пространства"
		>
			<div className={styles.actions}>
				<h2>Закрытые пространства</h2>
				<Button
					size="sm"
					variant="secondary"
					isLoading={closures.isFetching}
					onClick={() => void closures.refetch()}
				>
					Обновить список
				</Button>
			</div>
			{closures.isError ? (
				<p className={styles.notice} role="alert">
					Список закрытий временно недоступен. Повторите загрузку.
				</p>
			) : null}
			{!closures.isError &&
			!closures.isPending &&
			!closures.data?.items.length ? (
				<p className={styles.muted}>Закрытых пространств пока нет.</p>
			) : null}
			{!closures.isError && closures.data?.items.length ? (
				<ul className={styles.history}>
					{closures.data.items.map(item => (
						<li key={item.id}>
							<span>
								<strong>
									{item.displayName?.trim() ||
										`Пространство ${item.workspaceId.slice(0, 8)}`}
								</strong>{' '}
								· {item.state === 'CLOSED' ? 'Закрыто' : 'Закрывается'}
							</span>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									if (onSelect) onSelect(item.workspaceId)
									else setSelected(item.id)
								}}
							>
								Открыть историю
							</Button>
						</li>
					))}
				</ul>
			) : null}
			{!closures.isError && selectedClosure && !onSelect ? (
				<WorkspaceClosureStatus
					key={selectedClosure.id}
					initial={selectedClosure}
				/>
			) : null}
		</section>
	)
}
