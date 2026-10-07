'use client'

import { TimeZoneSelect } from '@/shared/ui'

export const WorkdayTimeZoneSelect = ({
	value,
	onChange
}: {
	value: string
	onChange: (value: string) => void
}) => (
	<TimeZoneSelect
		value={value}
		onChange={onChange}
		hint="Выбранный пояс применяется к периоду задач. Смещение UTC указано на сегодня."
	/>
)
