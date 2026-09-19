'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Button, SelectField, TextField } from '@/shared/ui'
import {
	assigneeDisplayName,
	type AssigneeBinding,
	type AssigneeOption
} from '../model/assignee-options.contract'
import type { useAssigneeOptions } from '../model/use-assignee-options'
import styles from './AssigneeSelect.module.scss'

export interface AssigneeSelectProps {
	options: ReturnType<typeof useAssigneeOptions>
	value: AssigneeBinding | null
	onChange: (option: AssigneeOption) => void
	disabled?: boolean
	label?: string
}
export const AssigneeSelect = ({
	options,
	value,
	onChange,
	disabled = false,
	label = 'Ответственный'
}: AssigneeSelectProps) => {
	const [draft, setDraft] = useState({
		scopeKey: options.scopeKey,
		value: options.search
	})
	const search =
		draft.scopeKey === options.scopeKey ? draft.value : options.search
	const selected = value ? options.resolveBinding(value) : null
	const items = options.data?.items ?? []
	const selectable =
		options.data?.selected &&
		!items.some(
			item => item.membershipId === options.data!.selected!.membershipId
		)
			? [options.data.selected, ...items]
			: items
	const blocked = disabled || !options.enabled
	const unavailable = !!value && !!options.data && !selected
	const applySearch = () => {
		if (blocked || options.loading || !options.isCurrent()) return
		options.setSearch(search)
		toast('Поиск сотрудника обновлён')
	}
	return (
		<div className={styles.content}>
			<div className={styles.search}>
				<TextField
					label="Поиск сотрудника"
					value={search}
					maxLength={200}
					disabled={blocked}
					placeholder="ФИО или email"
					autoComplete="off"
					onChange={event =>
						setDraft({
							scopeKey: options.scopeKey,
							value: event.target.value
						})
					}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							event.preventDefault()
							applySearch()
						}
					}}
				/>
				<Button
					variant="secondary"
					disabled={blocked || options.loading}
					onClick={applySearch}
				>
					Найти
				</Button>
			</div>
			<SelectField
				label={label}
				value={
					selected?.membershipId ?? (value ? 'current-unavailable' : '')
				}
				disabled={
					blocked || options.loading || options.error || !options.data
				}
				error={
					options.error
						? 'Не удалось загрузить сотрудников. Текущий ответственный не изменён.'
						: unavailable
							? 'Текущий ответственный недоступен или его доступ изменился. Выберите сотрудника явно.'
							: undefined
				}
				hint={
					options.loading
						? 'Загружаем сотрудников…'
						: !options.enabled
							? 'Выбор доступен после подтверждения прав.'
							: options.data?.total === 0
								? options.search
									? 'По вашему запросу сотрудники не найдены.'
									: 'Доступных сотрудников пока нет.'
								: undefined
				}
				onChange={event => {
					const candidate = selectable.find(
						item => item.membershipId === event.target.value
					)
					const verified = candidate && options.resolveBinding(candidate)
					if (blocked || !verified) return
					onChange(verified)
					toast.success('Ответственный выбран')
				}}
			>
				<option value="" disabled>
					Выберите сотрудника
				</option>
				{value && !selected ? (
					<option value="current-unavailable" disabled>
						{options.loading
							? 'Проверяем текущего ответственного…'
							: 'Текущий ответственный недоступен'}
					</option>
				) : null}
				{selectable.map(item => (
					<option key={item.membershipId} value={item.membershipId}>
						{assigneeDisplayName(item)}
						{item.verifiedEmail && item.displayName?.trim()
							? ` · ${item.verifiedEmail}`
							: ''}
					</option>
				))}
			</SelectField>
			{options.error ? (
				<Button
					variant="secondary"
					disabled={blocked || options.loading}
					onClick={async () => {
						const success = await options.refetch()
						if (!options.isCurrent()) return
						if (success) toast.success('Список сотрудников обновлён')
						else toast.error('Не удалось загрузить сотрудников')
					}}
				>
					Повторить загрузку сотрудников
				</Button>
			) : null}
			{options.page > 1 ||
			(options.data?.total ?? 0) > options.pageSize ? (
				<nav
					className={styles.pagination}
					aria-label="Страницы сотрудников"
				>
					<Button
						variant="secondary"
						disabled={
							blocked ||
							options.loading ||
							!options.data ||
							options.page === 1
						}
						onClick={() => {
							if (!options.isCurrent()) return
							options.setPage(options.page - 1)
							toast('Предыдущая страница сотрудников')
						}}
					>
						Назад
					</Button>
					<span aria-live="polite">Страница {options.page}</span>
					<Button
						variant="secondary"
						disabled={
							blocked ||
							options.loading ||
							!options.data ||
							options.page * options.pageSize >= options.data.total
						}
						onClick={() => {
							if (!options.isCurrent()) return
							options.setPage(options.page + 1)
							toast('Следующая страница сотрудников')
						}}
					>
						Далее
					</Button>
				</nav>
			) : null}
		</div>
	)
}
