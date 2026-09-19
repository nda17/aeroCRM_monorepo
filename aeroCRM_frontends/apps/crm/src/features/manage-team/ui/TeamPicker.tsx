'use client'

import { listTeamRecords } from '@/entities/crm-team'
import { Button, ScreenState } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { useTeamSession } from '../model/use-team-session'
import styles from './TeamEditor.module.scss'

export const TeamPicker = ({
	context,
	selected,
	disabled,
	onChange
}: {
	context: ReturnType<typeof useTeamSession>
	selected: string[]
	disabled: boolean
	onChange: (ids: string[]) => void
}) => {
	const [page, setPage] = useState(1)
	const records = useQuery({
		queryKey: ['crm-team-picker', ...context.key, page],
		enabled: context.canRead,
		queryFn: () =>
			listTeamRecords(
				context.session!.accessToken,
				context.workspace.workspaceId,
				'teams',
				page,
				10
			),
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	return (
		<fieldset className={styles.picker} disabled={disabled}>
			<legend>Отделы сотрудника</legend>
			<p className={styles.muted}>
				Выбрано: {selected.length}. Выбор сохраняется при переходе между
				страницами.
			</p>
			{records.isError ? (
				<ScreenState
					compact
					variant="error"
					description="Не удалось загрузить отделы"
					action={
						<Button
							variant="secondary"
							onClick={() => void records.refetch()}
						>
							Повторить
						</Button>
					}
				/>
			) : records.isPending || records.isFetching ? (
				<ScreenState compact variant="loading" />
			) : records.data.items.length ? (
				<div className={styles.checklist}>
					{records.data.items.map(row =>
						row.kind === 'team' ? (
							<label key={row.id} className={styles.check}>
								<input
									type="checkbox"
									checked={selected.includes(row.id)}
									onChange={event =>
										onChange(
											event.target.checked
												? [...selected, row.id]
												: selected.filter(id => id !== row.id)
										)
									}
								/>
								<span>{row.name}</span>
							</label>
						) : null
					)}
				</div>
			) : (
				<p className={styles.muted}>
					Отделов пока нет. Их можно создать во вкладке «Отделы».
				</p>
			)}
			<div className={styles.actions}>
				<Button
					size="sm"
					variant="secondary"
					disabled={page === 1 || records.isFetching}
					onClick={() => setPage(value => value - 1)}
				>
					Предыдущие отделы
				</Button>
				<span>{page}</span>
				<Button
					size="sm"
					variant="secondary"
					disabled={
						records.isError ||
						records.isFetching ||
						page * 10 >= (records.data?.total ?? 0)
					}
					onClick={() => setPage(value => value + 1)}
				>
					Следующие отделы
				</Button>
			</div>
		</fieldset>
	)
}
