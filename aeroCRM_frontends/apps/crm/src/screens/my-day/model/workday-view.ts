import type {
	WorkdayFilters,
	WorkdayStatus,
	WorkdayTask
} from '@/entities/crm-workday'
import { expectedWorkdayRange } from '@/entities/crm-workday/model/workday-period'

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
export type WorkdayView = 'list' | 'board'
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
