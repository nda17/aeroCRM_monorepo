import type {
	WorkdayCommand,
	WorkdayFilters,
	WorkdayTask,
	WorkdayTaskPage,
	WorkdayTimelineEntry
} from './workday.types'

export const workspaceId = '11111111-1111-4111-8111-111111111111'
export const taskId = '22222222-2222-4222-8222-222222222222'
export const membershipId = '33333333-3333-4333-8333-333333333333'
export const commandId = '44444444-4444-4444-8444-444444444444'
export const otherId = '55555555-5555-4555-8555-555555555555'
export const date = '2026-09-07T12:00:00.000Z'
export const task: WorkdayTask = {
	id: taskId,
	workspaceId,
	dealId: null,
	version: 1,
	title: 'Позвонить',
	dueAt: date,
	status: 'OPEN',
	assignedToSubject: 'actor',
	assignedToMembershipId: membershipId,
	teamId: null,
	completedAt: null,
	createdAt: date,
	updatedAt: date
}
export const filters = {
	page: 1,
	pageSize: 20,
	scope: 'MINE',
	period: 'TODAY',
	timeZone: 'Europe/Moscow'
} satisfies WorkdayFilters
export const binding = { workspaceId, subject: 'actor' }
export const page: WorkdayTaskPage = {
	schemaVersion: 1,
	...binding,
	page: 1,
	pageSize: 20,
	total: 1,
	items: [task],
	counts: { OPEN: 1, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 },
	overdueCount: 0,
	asOf: date,
	timeZone: filters.timeZone,
	range: {
		from: '2026-09-06T21:00:00.000Z',
		until: '2026-09-07T21:00:00.000Z'
	}
}
export const entry: WorkdayTimelineEntry = {
	id: otherId,
	workspaceId,
	taskId,
	actorSubject: 'actor',
	kind: 'CREATED',
	before: null,
	after: task,
	createdAt: date
}
export const command: WorkdayCommand = {
	...binding,
	commandId,
	sessionRevision: 1,
	mutation: {
		kind: 'create',
		title: task.title,
		dueAt: date,
		dealId: null,
		teamId: null,
		assignee: { subject: 'actor', membershipId }
	}
}
