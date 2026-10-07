'use client'

import {
	useMemo,
	useState,
	useSyncExternalStore,
	type ReactNode
} from 'react'
import {
	browserWorkdayTimeZones,
	isIanaTimeZone,
	workdayTimeZoneGroups,
	searchWorkdayTimeZones
} from '@/shared/lib/time-zones'
import { SelectField } from './SelectField'
import { TextField } from './TextField'
import styles from './FormField.module.scss'

const subscribe = () => () => {}
export const TimeZoneSelect = ({
	value,
	onChange,
	disabled,
	label = 'Часовой пояс',
	allowEmpty = false,
	labelHelp,
	hint = 'Сроки рассчитываются по выбранному часовому поясу.'
}: {
	value: string
	onChange: (value: string) => void
	disabled?: boolean
	label?: ReactNode
	allowEmpty?: boolean
	labelHelp?: ReactNode
	hint?: string
}) => {
	const [search, setSearch] = useState('')
	const hydrated = useSyncExternalStore(
		subscribe,
		() => true,
		() => false
	)
	const zones = useMemo(
		() => (hydrated ? browserWorkdayTimeZones() : null),
		[hydrated]
	)
	const groups = useMemo(
		() => workdayTimeZoneGroups(value, zones),
		[value, zones]
	)
	const offsetDate = useMemo(
		() => (hydrated ? new Date() : undefined),
		[hydrated]
	)
	const labeledGroups = useMemo(
		() => searchWorkdayTimeZones(groups, '', value, offsetDate).groups,
		[groups, value, offsetDate]
	)
	const result = useMemo(
		() => searchWorkdayTimeZones(labeledGroups, search, value),
		[labeledGroups, search, value]
	)
	return (
		<div className={styles.timeZoneFields}>
			<TextField
				label={`Найти: ${typeof label === 'string' ? label.toLocaleLowerCase('ru-RU') : 'часовой пояс'}`}
				type="search"
				value={search}
				maxLength={100}
				disabled={disabled}
				placeholder="Город, UTC+10 или Asia/Vladivostok"
				onChange={event => setSearch(event.target.value)}
			/>
			<SelectField
				label={label}
				labelHelp={labelHelp}
				value={value}
				disabled={disabled}
				hint={hint}
				error={
					hydrated &&
					!(allowEmpty && value === '') &&
					!isIanaTimeZone(value)
						? 'Выберите доступный часовой пояс IANA из списка'
						: undefined
				}
				onChange={event => {
					if (
						(allowEmpty && event.target.value === '') ||
						isIanaTimeZone(event.target.value)
					)
						onChange(event.target.value)
				}}
			>
				{allowEmpty ? (
					<option value="">Не указан</option>
				) : !value ? (
					<option value="" disabled>
						Выберите часовой пояс
					</option>
				) : null}
				{result.groups.map(group => (
					<optgroup key={group.label} label={group.label}>
						{group.options.map(option => (
							<option
								key={option.value}
								value={option.value}
								disabled={option.disabled}
							>
								{option.label}
							</option>
						))}
					</optgroup>
				))}
			</SelectField>
			{search.trim() && !result.matches ? (
				<p className={styles.hint} role="status">
					Ничего не найдено. Попробуйте другой город, пояс IANA или
					смещение UTC.
				</p>
			) : null}
		</div>
	)
}
