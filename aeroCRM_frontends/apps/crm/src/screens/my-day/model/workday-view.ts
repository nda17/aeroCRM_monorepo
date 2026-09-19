import type { WorkdayFilters, WorkdayStatus } from '@/entities/crm-workday'

export const WORKDAY_STATUS_LABELS: Record<WorkdayStatus, string> = {
	OPEN: 'К выполнению',
	IN_PROGRESS: 'В работе',
	COMPLETED: 'Готово',
	CANCELLED: 'Отменено'
}
export const WORKDAY_BOARD_STATUSES = [
	'OPEN',
	'IN_PROGRESS',
	'COMPLETED'
] as const
export type WorkdayView = 'list' | 'board'
export const initialWorkdayFilters = (): WorkdayFilters => ({
	period: 'TODAY',
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
