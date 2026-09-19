'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { SelectField } from '@/shared/ui'
import { isWorkdayTimeZone } from '@/entities/crm-workday'
import {
	browserWorkdayTimeZones,
	workdayTimeZoneGroups
} from '../model/workday-time-zones'

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

export const WorkdayTimeZoneSelect = ({
	value,
	onChange
}: {
	value: string
	onChange: (value: string) => void
}) => {
	const hydrated = useSyncExternalStore(
		subscribe,
		clientSnapshot,
		serverSnapshot
	)
	const browserZones = useMemo(
		() => (hydrated ? browserWorkdayTimeZones() : null),
		[hydrated]
	)
	const groups = useMemo(
		() => workdayTimeZoneGroups(value, browserZones),
		[value, browserZones]
	)
	return (
		<SelectField
			label="Часовой пояс"
			value={value}
			hint="Выбранный пояс применяется к периоду задач."
			error={
				hydrated && !isWorkdayTimeZone(value)
					? 'Выберите доступный часовой пояс IANA из списка'
					: undefined
			}
			onChange={event => {
				const next = event.target.value
				if (
					isWorkdayTimeZone(next) &&
					groups.some(group =>
						group.options.some(
							option => option.value === next && !option.disabled
						)
					)
				)
					onChange(next)
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
