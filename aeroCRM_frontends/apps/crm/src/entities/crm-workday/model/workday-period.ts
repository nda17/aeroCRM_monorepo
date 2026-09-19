import type { WorkdayDateFilter } from './workday.types'
import { isIanaTimeZone as isWorkdayTimeZone } from '@/shared/lib/time-zones'
export { isWorkdayTimeZone }

export const isWorkdayDate = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return false
	const time = Date.parse(`${value}T00:00:00.000Z`)
	return (
		Number.isFinite(time) &&
		new Date(time).toISOString().slice(0, 10) === value
	)
}

/** Validate the server's calendar boundaries using its asOf, never browser now.
 * Matches CRM Sales including 23/25-hour DST days and skipped local dates. */
export const expectedWorkdayRange = (
	filter: WorkdayDateFilter & { timeZone: string },
	asOf: string
): { from: string; until: string } | null | undefined => {
	if (!isWorkdayTimeZone(filter.timeZone)) return undefined
	if (
		!['DAY', 'RANGE'].includes(filter.period) &&
		(filter.from !== undefined || filter.to !== undefined)
	)
		return undefined
	if (filter.period === 'ALL' || filter.period === 'OVERDUE') return null
	try {
		const formatter = new Intl.DateTimeFormat('en-CA', {
			timeZone: filter.timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			calendar: 'iso8601',
			numberingSystem: 'latn'
		})
		const dayAt = (time: number) => {
			const parts = formatter.formatToParts(new Date(time))
			return ['year', 'month', 'day']
				.map(key =>
					parts
						.find(part => part.type === key)!
						.value.padStart(key === 'year' ? 4 : 2, '0')
				)
				.join('-')
		}
		const shift = (day: string, days: number) => {
			const next = new Date(
				Date.parse(`${day}T00:00:00.000Z`) + days * 86400000
			)
				.toISOString()
				.slice(0, 10)
			if (!isWorkdayDate(next)) throw new Error('Invalid date')
			return next
		}
		let from = dayAt(Date.parse(asOf)),
			to = from
		if (filter.period === 'TOMORROW') from = to = shift(from, 1)
		if (filter.period === 'WEEK') {
			from = shift(
				from,
				-((new Date(`${from}T00:00:00.000Z`).getUTCDay() + 6) % 7)
			)
			to = shift(from, 6)
		}
		if (filter.period === 'DAY' || filter.period === 'RANGE') {
			if (
				!isWorkdayDate(filter.from) ||
				(filter.period === 'DAY' && filter.to !== undefined)
			)
				return undefined
			from = filter.from
			to = filter.period === 'DAY' ? from : filter.to
			if (!isWorkdayDate(to) || from > to) return undefined
		}
		const start = (day: string) => {
			const center = Date.parse(`${day}T00:00:00.000Z`)
			let low = center - 36 * 3600000,
				high = center + 36 * 3600000
			while (low < high) {
				const middle = Math.floor((low + high) / 2)
				if (dayAt(middle) < day) low = middle + 1
				else high = middle
			}
			return new Date(low).toISOString()
		}
		return { from: start(from), until: start(shift(to, 1)) }
	} catch {
		return undefined
	}
}
