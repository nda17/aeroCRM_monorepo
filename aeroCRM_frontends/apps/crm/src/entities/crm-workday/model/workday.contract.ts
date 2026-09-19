import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import { expectedWorkdayRange, isWorkdayTimeZone } from './workday-period'
import {
	WORKDAY_PERIODS,
	WORKDAY_STATUSES,
	type WorkdayBinding,
	type WorkdayCommand,
	type WorkdayFilters,
	type WorkdayListRequest,
	type WorkdayPage,
	type WorkdayPagination,
	type WorkdayTask,
	type WorkdayTaskPage,
	type WorkdayTimelineEntry
} from './workday.types'

export const isWorkdaySubject = (value: unknown): value is string =>
	typeof value === 'string' && /^[^\s\x00-\x1f\x7f]{1,256}$/.test(value)
const integer = (
	value: unknown,
	min: number,
	max = Number.MAX_SAFE_INTEGER
) =>
	Number.isSafeInteger(value) &&
	Number(value) >= min &&
	Number(value) <= max
const nullableUuid = (value: unknown) => value === null || isUuidV4(value)
const status = (value: unknown) =>
	WORKDAY_STATUSES.some(item => item === value)
const active = (value: WorkdayTask['status']) =>
	value === 'OPEN' || value === 'IN_PROGRESS'
export const validWorkdayPagination = (value: WorkdayPagination) =>
	integer(value.page, 1, 1000000) && integer(value.pageSize, 1, 100)
export const validWorkdayBinding = (value: WorkdayBinding) =>
	isUuidV4(value.workspaceId) && isWorkdaySubject(value.subject)
export const validWorkdayFilters = (value: WorkdayFilters): boolean =>
	validWorkdayPagination(value) &&
	['MINE', 'TEAM', 'ALL'].includes(value.scope) &&
	WORKDAY_PERIODS.includes(value.period) &&
	isWorkdayTimeZone(value.timeZone) &&
	(value.teamId === undefined || isUuidV4(value.teamId)) &&
	(value.assigneeSubject === undefined ||
		isWorkdaySubject(value.assigneeSubject)) &&
	(value.status === undefined || status(value.status)) &&
	(value.search === undefined ||
		(typeof value.search === 'string' && value.search.length <= 200)) &&
	expectedWorkdayRange(value, '2026-01-01T12:00:00.000Z') !== undefined

export const parseWorkdayTask = (
	value: unknown,
	workspaceId: string,
	id?: string
): WorkdayTask | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'dealId',
			'version',
			'title',
			'dueAt',
			'status',
			'assignedToSubject',
			'assignedToMembershipId',
			'teamId',
			'completedAt',
			'createdAt',
			'updatedAt'
		]) ||
		!isUuidV4(workspaceId) ||
		value.workspaceId !== workspaceId ||
		!isUuidV4(value.id) ||
		(id !== undefined && value.id !== id) ||
		!nullableUuid(value.dealId) ||
		!nullableUuid(value.teamId) ||
		!nullableUuid(value.assignedToMembershipId) ||
		!integer(value.version, 1, 2147483647) ||
		!isNonEmptyString(value.title, 200) ||
		!isWorkdaySubject(value.assignedToSubject) ||
		!status(value.status) ||
		!isIsoDate(value.dueAt) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt) ||
		!(value.completedAt === null || isIsoDate(value.completedAt)) ||
		active(value.status as WorkdayTask['status']) !==
			(value.completedAt === null)
	)
		return null
	return value as unknown as WorkdayTask
}
export const parseWorkdayTaskResult = (
	value: unknown,
	workspaceId: string,
	id?: string
): WorkdayTask | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'task']) ||
		value.schemaVersion !== 1
	)
		return null
	return parseWorkdayTask(value.task, workspaceId, id)
}
const parsePage = <T extends { id: string }>(
	value: Record<string, unknown>,
	request: WorkdayPagination,
	parser: (value: unknown) => T | null
): WorkdayPage<T> | null => {
	if (
		!validWorkdayPagination(request) ||
		value.schemaVersion !== 1 ||
		value.page !== request.page ||
		value.pageSize !== request.pageSize ||
		!integer(value.total, 0) ||
		!Array.isArray(value.items) ||
		value.items.length !==
			Math.min(
				request.pageSize,
				Math.max(
					0,
					Number(value.total) - (request.page - 1) * request.pageSize
				)
			)
	)
		return null
	const items = value.items.map(parser)
	if (
		items.some(item => item === null) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	return {
		schemaVersion: 1,
		...request,
		total: Number(value.total),
		items: items as T[]
	}
}
export const parseWorkdayTaskPage = (
	value: unknown,
	request: WorkdayListRequest
): WorkdayTaskPage | null => {
	if (
		!validWorkdayBinding(request) ||
		!validWorkdayFilters(request) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'subject',
			'page',
			'pageSize',
			'total',
			'items',
			'counts',
			'overdueCount',
			'asOf',
			'timeZone',
			'range'
		]) ||
		value.workspaceId !== request.workspaceId ||
		value.subject !== request.subject ||
		value.timeZone !== request.timeZone ||
		!isIsoDate(value.asOf) ||
		!integer(value.overdueCount, 0) ||
		!isRecord(value.counts) ||
		!hasExactKeys(value.counts, WORKDAY_STATUSES) ||
		!WORKDAY_STATUSES.every(key =>
			integer((value.counts as Record<string, unknown>)[key], 0)
		)
	)
		return null
	const range = expectedWorkdayRange(request, value.asOf)
	if (
		range === undefined ||
		(range === null
			? value.range !== null
			: !isRecord(value.range) ||
				!hasExactKeys(value.range, ['from', 'until']) ||
				value.range.from !== range.from ||
				value.range.until !== range.until)
	)
		return null
	const page = parsePage(
		value,
		{ page: request.page, pageSize: request.pageSize },
		item => parseWorkdayTask(item, request.workspaceId)
	)
	if (!page) return null
	const counts = value.counts as WorkdayTaskPage['counts']
	if (
		WORKDAY_STATUSES.some(
			status =>
				page.items.filter(task => task.status === status).length >
				counts[status]
		)
	)
		return null
	const total = WORKDAY_STATUSES.reduce((sum, key) => sum + counts[key], 0)
	if (
		!Number.isSafeInteger(total) ||
		page.total !== (request.status ? counts[request.status] : total) ||
		(request.period === 'OVERDUE' &&
			(counts.COMPLETED !== 0 ||
				counts.CANCELLED !== 0 ||
				value.overdueCount !== total))
	)
		return null
	if (
		page.items.some(
			(task, index) =>
				(request.scope === 'MINE' &&
					task.assignedToSubject !== request.subject) ||
				(request.assigneeSubject !== undefined &&
					task.assignedToSubject !== request.assigneeSubject) ||
				(request.teamId !== undefined && task.teamId !== request.teamId) ||
				(request.status !== undefined && task.status !== request.status) ||
				(range !== null &&
					!(task.dueAt >= range.from && task.dueAt < range.until)) ||
				(request.period === 'OVERDUE' &&
					(!active(task.status) || task.dueAt >= value.asOf!)) ||
				(index > 0 &&
					(page.items[index - 1].dueAt > task.dueAt ||
						(page.items[index - 1].dueAt === task.dueAt &&
							page.items[index - 1].id.toLowerCase() >
								task.id.toLowerCase())))
		)
	)
		return null
	return {
		...page,
		workspaceId: request.workspaceId,
		subject: request.subject,
		counts,
		overdueCount: Number(value.overdueCount),
		asOf: value.asOf,
		timeZone: request.timeZone,
		range
	}
}
export const parseWorkdayTimelineEntry = (
	value: unknown,
	workspaceId: string,
	taskId: string
): WorkdayTimelineEntry | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'taskId',
			'actorSubject',
			'kind',
			'before',
			'after',
			'createdAt'
		]) ||
		!isUuidV4(value.id) ||
		value.workspaceId !== workspaceId ||
		value.taskId !== taskId ||
		!isWorkdaySubject(value.actorSubject) ||
		!isIsoDate(value.createdAt) ||
		!['CREATED', 'EDITED', 'STATUS_CHANGED', 'ASSIGNED'].includes(
			String(value.kind)
		)
	)
		return null
	const after = parseWorkdayTask(value.after, workspaceId, taskId)
	const before =
		value.before === null
			? null
			: parseWorkdayTask(value.before, workspaceId, taskId)
	if (
		!after ||
		(value.kind === 'CREATED'
			? value.before !== null || after.version !== 1
			: !before || after.version !== before.version + 1)
	)
		return null
	return { ...value, before, after } as unknown as WorkdayTimelineEntry
}
export const parseWorkdayTimelinePage = (
	value: unknown,
	binding: WorkdayBinding & WorkdayPagination & { id: string }
): WorkdayPage<WorkdayTimelineEntry> | null => {
	if (
		!validWorkdayBinding(binding) ||
		!isUuidV4(binding.id) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'page',
			'pageSize',
			'total',
			'items'
		])
	)
		return null
	return parsePage(
		value,
		{ page: binding.page, pageSize: binding.pageSize },
		item =>
			parseWorkdayTimelineEntry(item, binding.workspaceId, binding.id)
	)
}

export const validWorkdayCommand = (
	value: unknown
): value is WorkdayCommand => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'workspaceId',
			'subject',
			'sessionRevision',
			'commandId',
			'mutation'
		]) ||
		!isUuidV4(value.workspaceId) ||
		!isWorkdaySubject(value.subject) ||
		!integer(value.sessionRevision, 0) ||
		!isUuidV4(value.commandId) ||
		!isRecord(value.mutation)
	)
		return false
	const mutation = value.mutation
	const common =
		mutation.kind === 'create'
			? ['kind']
			: ['kind', 'id', 'expectedVersion']
	if (
		mutation.kind !== 'create' &&
		(!isUuidV4(mutation.id) ||
			!integer(mutation.expectedVersion, 1, 2147483646))
	)
		return false
	const assignee = () =>
		isRecord(mutation.assignee) &&
		hasExactKeys(mutation.assignee, ['subject', 'membershipId']) &&
		isWorkdaySubject(mutation.assignee.subject) &&
		isUuidV4(mutation.assignee.membershipId)
	const fields = () =>
		isNonEmptyString(mutation.title, 200) &&
		isIsoDate(mutation.dueAt) &&
		/^\d{4}-/.test(mutation.dueAt)
	switch (mutation.kind) {
		case 'create':
			return (
				hasExactKeys(mutation, [
					...common,
					'title',
					'dueAt',
					'dealId',
					'teamId',
					'assignee'
				]) &&
				fields() &&
				nullableUuid(mutation.dealId) &&
				nullableUuid(mutation.teamId) &&
				assignee()
			)
		case 'edit':
			return (
				hasExactKeys(mutation, [...common, 'title', 'dueAt']) && fields()
			)
		case 'status':
			return (
				hasExactKeys(mutation, [...common, 'status']) &&
				status(mutation.status)
			)
		case 'assignee':
			return hasExactKeys(mutation, [...common, 'assignee']) && assignee()
		default:
			return false
	}
}

export const parseWorkdayCommandResult = (
	value: unknown,
	command: WorkdayCommand
): WorkdayTask | null => {
	if (!validWorkdayCommand(command)) return null
	const mutation = command.mutation
	const task = parseWorkdayTaskResult(
		value,
		command.workspaceId,
		mutation.kind === 'create' ? undefined : mutation.id
	)
	if (
		!task ||
		task.version !==
			(mutation.kind === 'create' ? 1 : mutation.expectedVersion + 1)
	)
		return null
	if (
		(mutation.kind === 'create' || mutation.kind === 'edit') &&
		(task.title !== mutation.title.trim() || task.dueAt !== mutation.dueAt)
	)
		return null
	if (
		(mutation.kind === 'create' || mutation.kind === 'assignee') &&
		(task.assignedToSubject !== mutation.assignee.subject ||
			task.assignedToMembershipId !== mutation.assignee.membershipId)
	)
		return null
	if (
		mutation.kind === 'create' &&
		(task.status !== 'OPEN' ||
			task.dealId !== mutation.dealId ||
			(mutation.dealId === null && task.teamId !== mutation.teamId) ||
			(mutation.teamId !== null && task.teamId !== mutation.teamId))
	)
		return null
	if (mutation.kind === 'status' && task.status !== mutation.status)
		return null
	return task
}
