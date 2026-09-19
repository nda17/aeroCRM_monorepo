import type {
	SeriesCommand,
	SeriesPageRequest,
	TaskSeries
} from './task-series.contract'
export const workspaceId = '11111111-1111-4111-8111-111111111111'
export const seriesId = '22222222-2222-4222-8222-222222222222'
export const membershipId = '33333333-3333-4333-8333-333333333333'
export const row: TaskSeries = {
	id: seriesId,
	workspaceId,
	version: 1,
	title: 'Еженедельный отчёт',
	dealId: null,
	teamId: null,
	assignee: { subject: 'actor', membershipId: null },
	frequency: 'WEEKLY',
	startDate: '2026-09-08',
	localTime: '10:00',
	timeZone: 'Europe/Moscow',
	status: 'ACTIVE',
	nextRunAt: '2026-09-14T21:00:00.000Z',
	blockedReason: null,
	createdAt: '2026-09-08T09:00:00.000Z',
	updatedAt: '2026-09-08T09:00:00.000Z'
}
export const request: SeriesPageRequest = {
	workspaceId,
	page: 1,
	pageSize: 10,
	status: 'ACTIVE'
}
export const page = {
	schemaVersion: 1,
	workspaceId,
	page: 1,
	pageSize: 10,
	total: 1,
	items: [row]
}
export const command: SeriesCommand = {
	commandId: '44444444-4444-4444-8444-444444444444',
	workspaceId,
	subject: 'actor',
	actorMembershipId: null,
	sessionRevision: 1,
	mutation: {
		kind: 'create',
		frequency: row.frequency,
		startDate: row.startDate,
		dealId: null,
		teamId: null,
		content: {
			title: row.title,
			localTime: row.localTime,
			timeZone: row.timeZone,
			assignee: row.assignee
		}
	}
}
