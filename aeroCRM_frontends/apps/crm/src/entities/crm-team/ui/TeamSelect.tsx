'use client'

import { Button, SelectField } from '@/shared/ui'
import toast from 'react-hot-toast'
import type { useTeamOptions } from '../model/use-team-options'
import styles from './TeamSelect.module.scss'

export const TeamSelect = ({
	options,
	value,
	onChange,
	disabled,
	label = 'Отдел',
	emptyLabel = 'Без отдела'
}: {
	options: ReturnType<typeof useTeamOptions>
	value: string
	onChange: (id: string) => boolean | void
	disabled: boolean
	label?: string
	emptyLabel?: string
}) => {
	const items = options.data?.items ?? []
	const selected = options.data?.selected
	const unavailable =
		!!value && !options.loading && !options.validSelection
	return (
		<div className={styles.content}>
			<SelectField
				label={label}
				value={value}
				disabled={disabled || options.loading}
				error={
					options.error
						? 'Не удалось загрузить отделы. Выбор не изменён.'
						: unavailable
							? `Выбранный отдел недоступен. Выберите другой отдел или «${emptyLabel}».`
							: undefined
				}
				hint={
					options.loading
						? 'Загружаем отделы…'
						: options.data?.total === 0
							? 'Доступных отделов пока нет.'
							: undefined
				}
				onChange={event => {
					if (onChange(event.target.value) !== false)
						toast(event.target.value ? 'Отдел выбран' : emptyLabel)
				}}
			>
				<option value="">{emptyLabel}</option>
				{value && !items.some(item => item.id === value) ? (
					<option value={value} disabled={!selected}>
						{selected?.name ??
							(options.loading
								? 'Проверяем выбранный отдел…'
								: 'Отдел недоступен')}
					</option>
				) : null}
				{items.map(item => (
					<option key={item.id} value={item.id}>
						{item.name}
					</option>
				))}
			</SelectField>
			{options.error ? (
				<Button
					size="sm"
					variant="secondary"
					disabled={disabled}
					onClick={async () => {
						const result = await options.refetch()
						if (result.isSuccess) toast.success('Список отделов обновлён')
						else toast.error('Не удалось загрузить отделы')
					}}
				>
					Повторить загрузку отделов
				</Button>
			) : null}
			{options.page > 1 || (options.data?.total ?? 0) > 20 ? (
				<nav className={styles.pagination} aria-label="Страницы отделов">
					<Button
						size="sm"
						variant="secondary"
						disabled={disabled || options.loading || options.page === 1}
						onClick={() => options.setPage(options.page - 1)}
					>
						Назад
					</Button>
					<span aria-live="polite">Страница {options.page}</span>
					<Button
						size="sm"
						variant="secondary"
						disabled={
							disabled ||
							!options.data ||
							options.page * 20 >= options.data.total
						}
						onClick={() => options.setPage(options.page + 1)}
					>
						Далее
					</Button>
				</nav>
			) : null}
		</div>
	)
}
