import { hasExactKeys, isRecord, isUuidV4 } from '@/shared/lib/contract'

export interface MailTemplate {
	id: string
	title: string
	subject: string
	body: string
	archived: boolean
}
export interface MailTemplatesSnapshot {
	schemaVersion: 1
	workspaceId: string
	version: number
	templates: MailTemplate[]
}
export interface SaveMailTemplatesCommand {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	expectedVersion: number
	templates: MailTemplate[]
}
const integer = (value: unknown, max: number) =>
	Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max
const single = (value: unknown, max: number) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= max &&
	value.trim().length > 0 &&
	!/[\x00-\x1f\x7f]/.test(value)
const multiline = (value: unknown) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= 4000 &&
	value.trim().length > 0 &&
	!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)

export const parseMailTemplates = (
	value: unknown
): MailTemplate[] | null => {
	if (!Array.isArray(value) || value.length > 100) return null
	const templates = value.map(item => {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, [
				'id',
				'title',
				'subject',
				'body',
				'archived'
			]) ||
			!isUuidV4(item.id) ||
			!single(item.title, 200) ||
			!single(item.subject, 300) ||
			!multiline(item.body) ||
			typeof item.archived !== 'boolean'
		)
			return null
		return item as unknown as MailTemplate
	})
	if (
		templates.some(item => item === null) ||
		new Set(templates.map(item => item!.id.toLowerCase())).size !==
			templates.length
	)
		return null
	return templates as MailTemplate[]
}

export const validSaveMailTemplatesCommand = (
	value: unknown
): value is SaveMailTemplatesCommand =>
	isRecord(value) &&
	hasExactKeys(value, [
		'schemaVersion',
		'workspaceId',
		'commandId',
		'expectedVersion',
		'templates'
	]) &&
	value.schemaVersion === 1 &&
	isUuidV4(value.workspaceId) &&
	isUuidV4(value.commandId) &&
	integer(value.expectedVersion, 2147483646) &&
	parseMailTemplates(value.templates) !== null

export const parseMailTemplatesSnapshot = (
	value: unknown,
	workspaceId: string
): MailTemplatesSnapshot | null => {
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
	const templates = parseMailTemplates(value.templates)
	return templates
		? {
				schemaVersion: 1,
				workspaceId,
				version: Number(value.version),
				templates
			}
		: null
}

export const parseSavedMailTemplates = (
	value: unknown,
	command: SaveMailTemplatesCommand
): MailTemplatesSnapshot | null => {
	if (!validSaveMailTemplatesCommand(command)) return null
	const result = parseMailTemplatesSnapshot(value, command.workspaceId)
	if (
		!result ||
		result.version !== command.expectedVersion + 1 ||
		result.templates.length !== command.templates.length
	)
		return null
	const normalize = (value: string) => value.replace(/\r\n?/g, '\n').trim()
	return result.templates.every((item, index) => {
		const source = command.templates[index]
		return (
			item.id.toLowerCase() === source.id.toLowerCase() &&
			item.title === normalize(source.title) &&
			item.subject === normalize(source.subject) &&
			item.body === normalize(source.body) &&
			item.archived === source.archived
		)
	})
		? result
		: null
}
