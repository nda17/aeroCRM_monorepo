'use client'

import { useMemo, useSyncExternalStore } from 'react'
import {
	browserWorkdayTimeZones,
	isIanaTimeZone,
	workdayTimeZoneGroups
} from '@/shared/lib/time-zones'
import { SelectField } from './SelectField'

const subscribe = () => () => {}
export const TimeZoneSelect = ({
	value,
	onChange,
	disabled,
	hint = 'Сроки рассчитываются по выбранному часовому поясу.'
}: {
	value: string
	onChange: (value: string) => void
	disabled?: boolean
	hint?: string
}) => {
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
	return (
		<SelectField
			label="Часовой пояс"
			value={value}
			disabled={disabled}
			hint={hint}
			error={
				hydrated && !isIanaTimeZone(value)
					? 'Выберите доступный часовой пояс IANA из списка'
					: undefined
			}
			onChange={event => {
				if (isIanaTimeZone(event.target.value))
					onChange(event.target.value)
			}}
		>
			{!value ? (
				<option value="" disabled>
					Выберите часовой пояс
				</option>
			) : null}
			{groups.map(group => (
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
	)
}
