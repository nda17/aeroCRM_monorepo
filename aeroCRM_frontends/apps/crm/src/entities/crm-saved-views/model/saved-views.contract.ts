import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import { validWorkdayFilters } from '@/entities/crm-workday/model/workday.contract'
import type { WorkdayFilters } from '@/entities/crm-workday/model/workday.types'
import type {
	SavedView,
	SavedViewBinding,
	SavedViewCommand,
	SavedViewCommandResult,
	SavedViewParameters,
	SavedViewScope,
	SavedViewsPage
} from './saved-views.types'

const subject = (value: unknown) =>
	typeof value === 'string' && /^[^\s\x00-\x1f\x7f]{1,256}$/.test(value)
const name = (value: unknown) =>
	isNonEmptyString(value, 60) && !/[\x00-\x1f\x7f]/.test(value)
const version = (value: unknown) =>
	Number.isSafeInteger(value) &&
	Number(value) >= 1 &&
	Number(value) <= 2147483647
const legacyKey = (value: unknown) =>
	typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const dealFields = [
	'search',
	'pipelineId',
	'status',
	'withoutNextAction',
	'layout',
	'sort',
	'stageId',
	'assignedToSubject',
	'overdue',
	'createdFrom',
	'createdTo'
] as const
const taskFields = [
	'layout',
	'period',
	'timeZone',
	'scope',
	'status',
	'search',
	'teamId',
	'assigneeSubject',
	'from',
	'to'
] as const
export const validSavedViewBinding = (binding: SavedViewBinding) =>
	isUuidV4(binding.workspaceId) &&
	subject(binding.subject) &&
	['DEALS', 'TASKS'].includes(binding.scope)

export const parseSavedViewParameters = (
	value: unknown,
	scope: SavedViewScope
): SavedViewParameters | null => {
	if (
		!isRecord(value) ||
		!['list', 'board'].some(layout => layout === value.layout)
	)
		return null
	if (scope === 'TASKS') {
		if (
			Object.keys(value).some(
				key => !taskFields.includes(key as (typeof taskFields)[number])
			) ||
			!validWorkdayFilters({
				...value,
				page: 1,
				pageSize: 20
			} as WorkdayFilters) ||
			(value.layout === 'board' &&
				value.status !== undefined &&
				value.status !== 'ACTIVE' &&
				value.status !== 'TERMINAL')
		)
			return null
	} else if (scope === 'DEALS') {
		if (
			Object.keys(value).some(
				key => !dealFields.includes(key as (typeof dealFields)[number])
			) ||
			typeof value.search !== 'string' ||
			value.search.length > 200 ||
			!(value.pipelineId === '' || isUuidV4(value.pipelineId)) ||
			!['', 'OPEN', 'WON', 'LOST'].some(
				status => status === value.status
			) ||
			typeof value.withoutNextAction !== 'boolean' ||
			![
				'created_desc',
				'updated_desc',
				'amount_desc',
				'next_action_asc'
			].some(sort => sort === value.sort) ||
			(value.stageId !== undefined && !isUuidV4(value.stageId)) ||
			(value.assignedToSubject !== undefined &&
				!subject(value.assignedToSubject)) ||
			(value.overdue !== undefined &&
				typeof value.overdue !== 'boolean') ||
			(value.createdFrom !== undefined && !isIsoDate(value.createdFrom)) ||
			(value.createdTo !== undefined && !isIsoDate(value.createdTo)) ||
			(value.createdFrom === undefined) !==
				(value.createdTo === undefined) ||
			(typeof value.createdFrom === 'string' &&
				typeof value.createdTo === 'string' &&
				value.createdFrom >= value.createdTo)
		)
			return null
	} else return null
	return value as unknown as SavedViewParameters
}

export const parseSavedView = (
	value: unknown,
	binding: SavedViewBinding
): SavedView | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'id',
			'workspaceId',
			'subject',
			'scope',
			'name',
			'parameters',
			'version',
			'legacyKey',
			'archivedAt',
			'createdAt',
			'updatedAt'
		]) ||
		!validSavedViewBinding(binding) ||
		!isUuidV4(value.id) ||
		value.workspaceId !== binding.workspaceId ||
		value.subject !== binding.subject ||
		value.scope !== binding.scope ||
		!name(value.name) ||
		!version(value.version) ||
		!(value.legacyKey === null || legacyKey(value.legacyKey)) ||
		!(value.archivedAt === null || isIsoDate(value.archivedAt)) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt) ||
		!parseSavedViewParameters(value.parameters, binding.scope)
	)
		return null
	return value as unknown as SavedView
}

export const parseSavedViewsPage = (
	value: unknown,
	binding: SavedViewBinding,
	imported = false
): SavedViewsPage | null => {
	if (
		!validSavedViewBinding(binding) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'subject',
			'scope',
			'items',
			...(imported ? ['createdCount', 'skippedCount'] : [])
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== binding.workspaceId ||
		value.subject !== binding.subject ||
		value.scope !== binding.scope ||
		!Array.isArray(value.items) ||
		value.items.length > 20
	)
		return null
	const items = value.items.map(item => parseSavedView(item, binding))
	if (
		items.some(item => !item || item.archivedAt !== null) ||
		new Set(items.map(item => item?.id.toLowerCase())).size !==
			items.length
	)
		return null
	return value as unknown as SavedViewsPage
}

const canonical = (value: unknown) =>
	JSON.stringify(
		isRecord(value)
			? Object.fromEntries(
					Object.entries(value)
						.filter(([, item]) => item !== undefined)
						.sort(([a], [b]) => a.localeCompare(b))
				)
			: value
	)

export const parseSavedViewCommandResult = (
	value: unknown,
	command: SavedViewCommand
): SavedViewCommandResult | null => {
	const mutation = command.mutation
	if (mutation.kind === 'import') {
		const page = parseSavedViewsPage(value, command, true)
		if (
			!page ||
			!isRecord(value) ||
			!Number.isSafeInteger(value.createdCount) ||
			!Number.isSafeInteger(value.skippedCount) ||
			Number(value.createdCount) < 0 ||
			Number(value.skippedCount) < 0 ||
			Number(value.createdCount) + Number(value.skippedCount) !==
				mutation.views.length
		)
			return null
		return value as unknown as SavedViewCommandResult
	}
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'view']) ||
		value.schemaVersion !== 1
	)
		return null
	const view = parseSavedView(value.view, command)
	if (
		!view ||
		(mutation.kind === 'delete'
			? view.archivedAt === null
			: view.archivedAt !== null)
	)
		return null
	if (mutation.kind === 'create') {
		if (
			view.version !== 1 ||
			view.legacyKey !== null ||
			view.name !== mutation.name.trim() ||
			canonical(view.parameters) !== canonical(mutation.parameters)
		)
			return null
	} else if (
		view.id !== mutation.id ||
		view.version !== mutation.expectedVersion + 1 ||
		(mutation.kind === 'rename' && view.name !== mutation.name.trim())
	)
		return null
	return { schemaVersion: 1, view }
}

export const validSavedViewCommand = (command: SavedViewCommand) => {
	if (
		!isRecord(command) ||
		!isRecord(command.mutation) ||
		!isUuidV4(command.commandId) ||
		!isUuidV4(command.workspaceId) ||
		!subject(command.subject) ||
		!['DEALS', 'TASKS'].includes(command.scope)
	)
		return false
	const mutation = command.mutation
	if (mutation.kind === 'create')
		return (
			name(mutation.name) &&
			!!parseSavedViewParameters(mutation.parameters, command.scope)
		)
	if (mutation.kind === 'import')
		return (
			command.scope === 'DEALS' &&
			Array.isArray(mutation.views) &&
			mutation.views.length > 0 &&
			mutation.views.length <= 10 &&
			mutation.views.every(view => isRecord(view)) &&
			new Set(mutation.views.map(view => view.legacyKey)).size ===
				mutation.views.length &&
			mutation.views.every(
				view =>
					legacyKey(view.legacyKey) &&
					name(view.name) &&
					!!parseSavedViewParameters(view.parameters, command.scope)
			)
		)
	return (
		['rename', 'delete'].includes(mutation.kind) &&
		isUuidV4(mutation.id) &&
		version(mutation.expectedVersion) &&
		mutation.expectedVersion < 2147483647 &&
		(mutation.kind !== 'rename' || name(mutation.name))
	)
}
