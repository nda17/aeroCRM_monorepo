import { hasExactKeys, isRecord, isUuidV4 } from '@/shared/lib/contract'

export interface ActivityTextTemplate {
	id: string
	title: string
	body: string
	archived: boolean
}

export interface ActivityTextTemplatesSnapshot {
	schemaVersion: 1
	workspaceId: string
	version: number
	templates: ActivityTextTemplate[]
}

export interface SaveActivityTextTemplatesCommand {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	expectedVersion: number
	templates: ActivityTextTemplate[]
}

const integer = (value: unknown, max: number) =>
	Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max

const cleanTitle = (value: unknown) =>
	typeof value === 'string' &&
	value.length >= 1 &&
	value.length <= 200 &&
	value.trim().length > 0 &&
	!/\x00|[\x01-\x1f\x7f]/.test(value)

const cleanBody = (value: unknown) =>
	typeof value === 'string' &&
	value.length >= 1 &&
	value.length <= 4000 &&
	value.trim().length > 0 &&
	!/\x00|[\x01-\x08\x0b\x0c]|[\x0e-\x1f\x7f]/.test(value)

const parseTemplates = (value: unknown): ActivityTextTemplate[] | null => {
	if (!Array.isArray(value) || value.length > 100) return null
	const templates = value.map(item => {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, ['id', 'title', 'body', 'archived']) ||
			!isUuidV4(item.id) ||
			!cleanTitle(item.title) ||
			!cleanBody(item.body) ||
			typeof item.archived !== 'boolean'
		)
			return null
		return item as unknown as ActivityTextTemplate
	})
	if (
		templates.some(template => template === null) ||
		new Set(templates.map(template => template!.id.toLowerCase())).size !==
			templates.length
	)
		return null
	return templates as ActivityTextTemplate[]
}

export const validSaveActivityTextTemplatesCommand = (
	command: unknown
): command is SaveActivityTextTemplatesCommand =>
	isRecord(command) &&
	hasExactKeys(command, [
		'schemaVersion',
		'workspaceId',
		'commandId',
		'expectedVersion',
		'templates'
	]) &&
	command.schemaVersion === 1 &&
	isUuidV4(command.workspaceId) &&
	isUuidV4(command.commandId) &&
	integer(command.expectedVersion, 2147483646) &&
	parseTemplates(command.templates) !== null

export const parseActivityTextTemplates = (
	value: unknown,
	workspaceId: string
): ActivityTextTemplatesSnapshot | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'version',
			'templates'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!integer(value.version, 2147483647)
	)
		return null
	const templates = parseTemplates(value.templates)
	return templates
		? {
				schemaVersion: 1,
				workspaceId,
				version: Number(value.version),
				templates
			}
		: null
}

const normalizeText = (value: string) =>
	value.replace(/\r\n?/g, '\n').trim()

export const parseSavedActivityTextTemplates = (
	value: unknown,
	command: SaveActivityTextTemplatesCommand
): ActivityTextTemplatesSnapshot | null => {
	if (!validSaveActivityTextTemplatesCommand(command)) return null
	const snapshot = parseActivityTextTemplates(value, command.workspaceId)
	if (!snapshot || snapshot.version !== command.expectedVersion + 1)
		return null
	const expected = command.templates
	return snapshot.templates.length === expected.length &&
		snapshot.templates.every((template, index) => {
			const source = expected[index]
			return (
				template.id.toLowerCase() === source.id.toLowerCase() &&
				template.title === normalizeText(source.title) &&
				template.body === normalizeText(source.body) &&
				template.archived === source.archived
			)
		})
		? snapshot
		: null
}
