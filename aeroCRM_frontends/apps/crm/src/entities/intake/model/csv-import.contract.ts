import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export const CSV_IMPORT_MAX_ROWS = 250
export const CSV_IMPORT_MAX_BYTES = 1024 * 1024

export interface CsvImportSummary {
	id: string
	workspaceId: string
	createdBySubject: string
	teamId: string | null
	label: string
	rowCount: number
	createdAt: string
}
export interface CsvImportCommand {
	workspaceId: string
	commandId: string
	label: string
	teamId: string | null
	rows: Array<{
		title: string
		name: string
		phone: string | null
		email: string | null
		message: string | null
	}>
}
const validLabel = (value: unknown) =>
	isNonEmptyString(value, 200) &&
	!['.', '..'].includes(value) &&
	!/[\/\\\x00-\x1f\x7f]/.test(value)

export const csvImportCommandError = (value: unknown): string | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'workspaceId',
			'commandId',
			'label',
			'teamId',
			'rows'
		]) ||
		!isUuidV4(value.workspaceId) ||
		!isUuidV4(value.commandId) ||
		!(value.teamId === null || isUuidV4(value.teamId))
	)
		return 'Не удалось подготовить безопасную команду импорта.'
	if (!validLabel(value.label))
		return 'Название импорта: от 1 до 200 символов, без пути и управляющих символов.'
	if (
		!Array.isArray(value.rows) ||
		value.rows.length < 1 ||
		value.rows.length > CSV_IMPORT_MAX_ROWS
	)
		return `Импорт должен содержать от 1 до ${CSV_IMPORT_MAX_ROWS} обращений.`
	for (const [index, row] of value.rows.entries()) {
		if (
			!isRecord(row) ||
			!hasExactKeys(row, ['title', 'name', 'phone', 'email', 'message']) ||
			!isNonEmptyString(row.title, 200) ||
			!isNonEmptyString(row.name, 200) ||
			!(
				row.phone === null ||
				(typeof row.phone === 'string' &&
					/^\+[1-9][0-9]{6,14}$/.test(row.phone))
			) ||
			!(
				row.email === null ||
				(typeof row.email === 'string' &&
					row.email.length <= 254 &&
					/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
			) ||
			!(
				row.message === null ||
				(typeof row.message === 'string' && row.message.length <= 5000)
			)
		)
			return `Строка ${index + 2}: проверьте тему, имя и контактные данные.`
	}
	if (
		new TextEncoder().encode(
			JSON.stringify({ schemaVersion: 1, ...value })
		).byteLength > CSV_IMPORT_MAX_BYTES
	)
		return 'JSON-команда превышает 1 МБ. Разделите обращения на несколько файлов.'
	return null
}
export const parseCsvImport = (
	value: unknown,
	workspaceId: string,
	id: string
): CsvImportSummary | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'import']) ||
		value.schemaVersion !== 1
	)
		return null
	const row = value.import
	if (
		!isRecord(row) ||
		!hasExactKeys(row, [
			'id',
			'workspaceId',
			'createdBySubject',
			'teamId',
			'label',
			'rowCount',
			'createdAt'
		]) ||
		!isUuidV4(id) ||
		!isUuidV4(workspaceId) ||
		row.id !== id ||
		row.workspaceId !== workspaceId ||
		!isNonEmptyString(row.createdBySubject, 256) ||
		!(row.teamId === null || isUuidV4(row.teamId)) ||
		!validLabel(row.label) ||
		!Number.isSafeInteger(row.rowCount) ||
		Number(row.rowCount) < 1 ||
		Number(row.rowCount) > CSV_IMPORT_MAX_ROWS ||
		!isIsoDate(row.createdAt)
	)
		return null
	return row as unknown as CsvImportSummary
}
