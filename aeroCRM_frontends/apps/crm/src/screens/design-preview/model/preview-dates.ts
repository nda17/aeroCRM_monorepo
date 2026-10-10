import type { PreviewTask } from './workspace-data'

export const days = [
	'Понедельник',
	'Вторник',
	'Среда',
	'Четверг',
	'Пятница',
	'Суббота',
	'Воскресенье'
]

export const calendarDayMs = 24 * 60 * 60 * 1000
export const calendarFormat = (
	date: number,
	options: Intl.DateTimeFormatOptions
) =>
	new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(
		date
	)

// Calendar values represent civil dates, independent of the browser time zone.
export const calendarToday = (timeZone: string) => {
	const parts = new Intl.DateTimeFormat('en-GB', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone
	}).formatToParts(new Date())
	const part = (type: string) =>
		Number(parts.find(item => item.type === type)?.value)
	return Date.UTC(part('year'), part('month') - 1, part('day'))
}
export const taskTime = (task: Pick<PreviewTask, 'due'>) => {
	const time = task.due.match(/,\s*(\d{1,2}):(\d{2})$/)
	if (!time || Number(time[1]) > 23 || Number(time[2]) > 59)
		return Infinity
	return Number(time[1]) * 60 + Number(time[2])
}
export const taskDate = (
	task: Pick<PreviewTask, 'due' | 'overdue'>,
	today: number
) => {
	const label = task.due.split(',')[0].trim().toLocaleLowerCase('ru')
	if (label === 'сегодня') return today
	if (label === 'завтра') return today + calendarDayMs
	if (label === 'вчера') return today - calendarDayMs
	const named = days.findIndex(
		day => day.toLocaleLowerCase('ru') === label
	)
	if (named >= 0) {
		const weekday = (new Date(today).getUTCDay() + 6) % 7
		let offset = (named - weekday + 7) % 7
		if (task.overdue && offset > 0) offset -= 7
		return today + offset * calendarDayMs
	}
	const parts = label.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
	if (parts) {
		const [, date, month, year] = parts.map(Number)
		const value = new Date(Date.UTC(year, month - 1, date))
		if (
			value.getUTCFullYear() === year &&
			value.getUTCMonth() === month - 1 &&
			value.getUTCDate() === date
		)
			return value.getTime()
	}
	return null
}

export const taskOverdue = (
	task: Pick<PreviewTask, 'due' | 'overdue' | 'status'>,
	timeZone: string
) => {
	const today = calendarToday(timeZone)
	const date = taskDate(task, today)
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	})
		.format(new Date())
		.split(':')
		.map(Number)
	return (
		task.status !== 'done' &&
		Number.isFinite(taskTime(task)) &&
		date !== null &&
		(date < today ||
			(date === today && taskTime(task) < parts[0] * 60 + parts[1]))
	)
}
