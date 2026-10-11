import type {
	WorkdayFilters,
	WorkdayStatus,
	WorkdayTask
} from '@/entities/crm-workday'
import {
	expectedWorkdayRange,
	isWorkdayDate
} from '@/entities/crm-workday/model/workday-period'

export const WORKDAY_STATUS_LABELS: Record<WorkdayStatus, string> = {
	OPEN: 'К выполнению',
	IN_PROGRESS: 'В работе',
	COMPLETED: 'Готово',
	CANCELLED: 'Отменено'
}
export const WORKDAY_BOARD_STATUSES = [
	'OPEN',
	'IN_PROGRESS',
	'COMPLETED',
	'CANCELLED'
] as const
export type WorkdayView = 'list' | 'board' | 'calendar'
export const initialWorkdayFilters = (): WorkdayFilters => ({
	period: 'ALL',
	status: 'ACTIVE',
	timeZone: 'Europe/Moscow',
	scope: 'MINE',
	page: 1,
	pageSize: 20
})
export const workdayDate = (value: string, timeZone: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone
	}).format(new Date(value))

/** Calendar arithmetic operates on local date labels, never 24-hour instants. */
export const workdayCalendarDay = (value: string, timeZone: string) => {
	try {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			calendar: 'iso8601',
			numberingSystem: 'latn'
		}).formatToParts(new Date(value))
		const day = ['year', 'month', 'day']
			.map(key =>
				parts
					.find(part => part.type === key)
					?.value.padStart(key === 'year' ? 4 : 2, '0')
			)
			.join('-')
		return isWorkdayDate(day) ? day : null
	} catch {
		return null
	}
}

export const shiftWorkdayCalendarDay = (day: string, offset: number) => {
	if (!isWorkdayDate(day) || !Number.isSafeInteger(offset)) return null
	const time = Date.parse(`${day}T00:00:00.000Z`) + offset * 86_400_000
	if (!Number.isFinite(time) || Math.abs(time) > 8_640_000_000_000_000)
		return null
	const next = new Date(time).toISOString().slice(0, 10)
	return isWorkdayDate(next) ? next : null
}

export const workdayCalendarWeek = (day: string) => {
	if (!isWorkdayDate(day)) return null
	const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay()
	const from = shiftWorkdayCalendarDay(day, -((weekday + 6) % 7))
	if (!from) return null
	const days = Array.from({ length: 7 }, (_, index) =>
		shiftWorkdayCalendarDay(from, index)
	)
	if (days.some(value => value === null)) return null
	return { from, to: days[6]!, days: days as string[] }
}

export const workdayCalendarFilters = (
	filters: WorkdayFilters,
	day: string
): WorkdayFilters | null => {
	const week = workdayCalendarWeek(day)
	return week
		? {
				...filters,
				period: 'RANGE',
				from: week.from,
				to: week.to,
				page: 1
			}
		: null
}

export const isWorkdayOverdue = (
	task: { status: WorkdayStatus; dueAt: string },
	asOf: string
) =>
	(task.status === 'OPEN' || task.status === 'IN_PROGRESS') &&
	Date.parse(task.dueAt) < Date.parse(asOf)

/** Group only this server page. Pagination and totals remain server-owned. */
export const groupWorkdayTasks = (
	tasks: readonly WorkdayTask[],
	asOf: string,
	timeZone: string
) => {
	const today = expectedWorkdayRange({ period: 'TODAY', timeZone }, asOf)
	if (!today) return []
	const groups: {
		id: 'overdue' | 'today' | 'upcoming'
		title: string
		items: WorkdayTask[]
	}[] = [
		{ id: 'overdue', title: 'Просроченные', items: [] },
		{ id: 'today', title: 'Сегодня', items: [] },
		{ id: 'upcoming', title: 'Предстоящие', items: [] }
	]
	for (const task of tasks) {
		if (task.status !== 'OPEN' && task.status !== 'IN_PROGRESS') continue
		const group = isWorkdayOverdue(task, asOf)
			? 0
			: task.dueAt < today.until
				? 1
				: 2
		groups[group].items.push(task)
	}
	return groups.filter(group => group.items.length > 0)
}

export const workdayLayoutStorageKey = (
	workspaceId: string,
	subject: string
) => `crm:task-layout:v1:${workspaceId}:${subject}`

export const readStoredWorkdayLayout = (key: string): WorkdayView => {
	try {
		const stored = window.localStorage.getItem(key)
		return stored === 'board' || stored === 'calendar' ? stored : 'list'
	} catch {
		return 'list'
	}
}

export const writeStoredWorkdayLayout = (
	key: string,
	view: WorkdayView
) => {
	try {
		window.localStorage.setItem(key, view)
	} catch {
		// The current layout stays usable when browser storage is unavailable.
	}
}
