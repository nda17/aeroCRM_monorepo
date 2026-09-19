export const WORKDAY_STATUSES = [
	'OPEN',
	'IN_PROGRESS',
	'COMPLETED',
	'CANCELLED'
] as const
export type WorkdayStatus = (typeof WORKDAY_STATUSES)[number]
export const WORKDAY_PERIODS = [
	'TODAY',
	'TOMORROW',
	'WEEK',
	'DAY',
	'RANGE',
	'ALL',
	'OVERDUE'
] as const
export type WorkdayPeriod = (typeof WORKDAY_PERIODS)[number]
export type WorkdayScope = 'MINE' | 'TEAM' | 'ALL'

export interface WorkdayBinding {
	workspaceId: string
	subject: string
}
export interface WorkdayPagination {
	page: number
	pageSize: number
}
export type WorkdayDateFilter =
	| {
			period: Exclude<WorkdayPeriod, 'DAY' | 'RANGE'>
			from?: never
			to?: never
	  }
	| { period: 'DAY'; from: string; to?: never }
	| { period: 'RANGE'; from: string; to: string }
export type WorkdayFilters = WorkdayPagination &
	WorkdayDateFilter & {
		timeZone: string
		scope: WorkdayScope
		teamId?: string
		assigneeSubject?: string
		search?: string
		status?: WorkdayStatus
	}
export type WorkdayListRequest = WorkdayBinding & WorkdayFilters
export interface WorkdayTask {
	id: string
	workspaceId: string
	dealId: string | null
	version: number
	title: string
	dueAt: string
	status: WorkdayStatus
	assignedToSubject: string
	// Legacy tasks keep their original assignee even before membership enrichment.
	assignedToMembershipId: string | null
	teamId: string | null
	completedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface WorkdayPage<T> extends WorkdayPagination {
	schemaVersion: 1
	total: number
	items: T[]
}
export interface WorkdayTaskPage
	extends WorkdayPage<WorkdayTask>, WorkdayBinding {
	counts: Record<WorkdayStatus, number>
	overdueCount: number
	asOf: string
	timeZone: string
	range: { from: string; until: string } | null
}
export interface WorkdayTimelineEntry {
	id: string
	workspaceId: string
	taskId: string
	actorSubject: string
	kind: 'CREATED' | 'EDITED' | 'STATUS_CHANGED' | 'ASSIGNED'
	before: WorkdayTask | null
	after: WorkdayTask
	createdAt: string
}
export interface WorkdayAssignee {
	subject: string
	membershipId: string
}
export type WorkdayMutation =
	| {
			kind: 'create'
			title: string
			dueAt: string
			dealId: string | null
			teamId: string | null
			assignee: WorkdayAssignee
	  }
	| {
			kind: 'edit'
			id: string
			expectedVersion: number
			title: string
			dueAt: string
	  }
	| {
			kind: 'status'
			id: string
			expectedVersion: number
			status: WorkdayStatus
	  }
	| {
			kind: 'assignee'
			id: string
			expectedVersion: number
			assignee: WorkdayAssignee
	  }
export interface WorkdayCommand extends WorkdayBinding {
	commandId: string
	// Local lifecycle binding, never a wire DTO or browser-persisted credential.
	sessionRevision: number
	mutation: WorkdayMutation
}
