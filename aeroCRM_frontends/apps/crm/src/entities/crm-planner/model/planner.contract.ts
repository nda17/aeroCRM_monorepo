import { hasExactKeys, isRecord, isUuidV4 } from '@/shared/lib/contract'
import {
	PLANNER_STATUSES,
	type PlannerSettings,
	type SavePlannerSettingsCommand
} from './planner.types'

const integer = (value: unknown, min: number) =>
	Number.isSafeInteger(value) && Number(value) >= min
const cleanText = (value: unknown, max: number) =>
	typeof value === 'string' &&
	value.trim().length > 0 &&
	value.length <= max &&
	!/\x00|[\x01-\x1f\x7f]/.test(value)
const isColumnId = (value: unknown) =>
	typeof value === 'string' &&
	(PLANNER_STATUSES.some(status => status === value) || isUuidV4(value))

const parseItems = (value: unknown) => {
	if (!isRecord(value)) return null
	if (
		!Array.isArray(value.templates) ||
		value.templates.length > 100 ||
		!Array.isArray(value.columns) ||
		value.columns.length < 4 ||
		value.columns.length > 50
	)
		return null
	const templates = value.templates.map(item => {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, ['id', 'title', 'archived']) ||
			!isUuidV4(item.id) ||
			!cleanText(item.title, 200) ||
			typeof item.archived !== 'boolean'
		)
			return null
		return item as unknown as PlannerSettings['templates'][number]
	})
	const columns = value.columns.map(item => {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, [
				'id',
				'name',
				'status',
				'isDefault',
				'archived'
			]) ||
			!isColumnId(item.id) ||
			!cleanText(item.name, 100) ||
			!PLANNER_STATUSES.some(status => status === item.status) ||
			typeof item.isDefault !== 'boolean' ||
			typeof item.archived !== 'boolean'
		)
			return null
		if (
			item.isDefault
				? item.id !== item.status || item.archived
				: !isUuidV4(item.id)
		)
			return null
		return item as unknown as PlannerSettings['columns'][number]
	})
	if (
		templates.some(item => item === null) ||
		columns.some(item => item === null)
	)
		return null
	if (
		new Set(templates.map(item => item!.id.toLowerCase())).size !==
			templates.length ||
		new Set(columns.map(item => item!.id.toLowerCase())).size !==
			columns.length
	)
		return null
	if (
		!PLANNER_STATUSES.every(status =>
			columns.some(
				item =>
					item?.id === status &&
					item.status === status &&
					item.isDefault &&
					!item.archived
			)
		)
	)
		return null
	return {
		templates: templates as PlannerSettings['templates'],
		columns: columns as PlannerSettings['columns']
	}
}

export const validSavePlannerSettingsCommand = (
	command: SavePlannerSettingsCommand
) =>
	isRecord(command) &&
	hasExactKeys(command, [
		'schemaVersion',
		'workspaceId',
		'commandId',
		'expectedVersion',
		'templates',
		'columns'
	]) &&
	command.schemaVersion === 1 &&
	isUuidV4(command.workspaceId) &&
	isUuidV4(command.commandId) &&
	integer(command.expectedVersion, 0) &&
	parseItems(command) !== null

export const parsePlannerSettings = (
	value: unknown,
	workspaceId: string,
	expectedVersion?: number
): PlannerSettings | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'version',
			'templates',
			'columns'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!integer(value.version, 0) ||
		(expectedVersion !== undefined && value.version !== expectedVersion)
	)
		return null
	const items = parseItems(value)
	return items
		? {
				schemaVersion: 1,
				workspaceId,
				version: Number(value.version),
				...items
			}
		: null
}

export const parseSavedPlannerSettings = (
	value: unknown,
	command: SavePlannerSettingsCommand
) => {
	const parsed = parsePlannerSettings(
		value,
		command.workspaceId,
		command.expectedVersion + 1
	)
	if (!parsed) return null
	const expectedTemplates = command.templates.map(item => ({
		...item,
		id: item.id.toLowerCase(),
		title: item.title.trim()
	}))
	const expectedColumns = command.columns.map(item => ({
		...item,
		id: item.isDefault ? item.id : item.id.toLowerCase(),
		name: item.name.trim()
	}))
	const sameTemplates =
		parsed.templates.length === expectedTemplates.length &&
		parsed.templates.every((item, index) => {
			const expected = expectedTemplates[index]
			return (
				item.id === expected.id &&
				item.title === expected.title &&
				item.archived === expected.archived
			)
		})
	const sameColumns =
		parsed.columns.length === expectedColumns.length &&
		parsed.columns.every((item, index) => {
			const expected = expectedColumns[index]
			return (
				item.id === expected.id &&
				item.name === expected.name &&
				item.status === expected.status &&
				item.isDefault === expected.isDefault &&
				item.archived === expected.archived
			)
		})
	return sameTemplates && sameColumns ? parsed : null
}
