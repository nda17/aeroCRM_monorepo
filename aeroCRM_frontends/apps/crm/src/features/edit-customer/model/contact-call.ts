import {
	validContactCallPreferences,
	type ContactCallPreferences
} from '@/entities/customer'

export const contactCallState = (
	preferences: ContactCallPreferences,
	now: Date
) => {
	if (!validContactCallPreferences(preferences) || !preferences.timeZone)
		return {
			status: 'UNKNOWN' as const,
			clock: 'Часовой пояс клиента не указан'
		}
	const clock = new Intl.DateTimeFormat('ru-RU', {
		timeZone: preferences.timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(now)
	const { preferredCallStart: start, preferredCallEnd: end } = preferences
	if (!start || !end) return { status: 'UNKNOWN' as const, clock }
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: preferences.timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(now)
	const local = `${parts.find(part => part.type === 'hour')!.value}:${parts.find(part => part.type === 'minute')!.value}`
	const allowed =
		start < end
			? local >= start && local < end
			: local >= start || local < end
	return {
		status: allowed ? ('ALLOWED' as const) : ('OUTSIDE' as const),
		clock
	}
}
export const openContactDialer = (phone: string) => {
	if (!/^\+[1-9][0-9]{6,14}$/.test(phone)) return
	window.location.assign(`tel:${phone}`)
}
