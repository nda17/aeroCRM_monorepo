// Bounded, text-only intake import. Parsing never executes spreadsheet formulas.
import {
	CSV_IMPORT_MAX_BYTES,
	CSV_IMPORT_MAX_ROWS
} from '@/entities/intake'

export const INBOX_CSV_MAX_ROWS = CSV_IMPORT_MAX_ROWS
export const INBOX_CSV_MAX_BYTES = CSV_IMPORT_MAX_BYTES
export interface InboxCsvRow {
	title: string
	name: string
	phone: string | null
	email: string | null
	message: string | null
}
export class InboxCsvError extends Error {
	constructor(
		message: string,
		readonly row?: number
	) {
		super(row ? `Строка ${row}: ${message}` : message)
		this.name = 'InboxCsvError'
	}
}
const columns: Record<string, keyof InboxCsvRow> = {
	title: 'title',
	тема: 'title',
	name: 'name',
	имя: 'name',
	phone: 'phone',
	телефон: 'phone',
	email: 'email',
	message: 'message',
	сообщение: 'message'
}

const delimiter = (text: string): ',' | ';' => {
	let quoted = false
	let commas = 0
	let semicolons = 0
	for (let index = 0; index < text.length; index++) {
		const char = text[index]
		if (char === '"') {
			if (quoted && text[index + 1] === '"') index++
			else quoted = !quoted
		} else if (!quoted) {
			if (char === '\r' || char === '\n') break
			if (char === ',') commas++
			if (char === ';') semicolons++
		}
	}
	if (!!commas === !!semicolons)
		throw new InboxCsvError(
			'В заголовке нужен один разделитель: запятая или точка с запятой.'
		)
	return semicolons ? ';' : ','
}

const records = (text: string, separator: string): string[][] => {
	const rows: string[][] = []
	let row: string[] = []
	let field = ''
	let state: 'plain' | 'quoted' | 'closed' = 'plain'
	const cell = () => {
		row.push(field)
		field = ''
		state = 'plain'
	}
	const line = () => {
		cell()
		if (row.some(value => value.trim())) rows.push(row)
		row = []
		if (rows.length > INBOX_CSV_MAX_ROWS + 1)
			throw new InboxCsvError(
				`В одном файле допускается до ${INBOX_CSV_MAX_ROWS} обращений.`
			)
	}
	for (let index = 0; index < text.length; index++) {
		const char = text[index]
		if (state === 'quoted') {
			if (char === '"') {
				if (text[index + 1] === '"') {
					field += '"'
					index++
				} else state = 'closed'
			} else field += char
			continue
		}
		if (char === separator) cell()
		else if (char === '\r' || char === '\n') {
			if (char === '\r' && text[index + 1] === '\n') index++
			line()
		} else if (char === '"' && state === 'plain' && field === '')
			state = 'quoted'
		else {
			if (state === 'closed' || char === '"')
				throw new InboxCsvError(
					'Некорректное экранирование кавычек.',
					rows.length + 1
				)
			field += char
		}
	}
	if (state === 'quoted')
		throw new InboxCsvError('Не закрыты кавычки.', rows.length + 1)
	if (row.length || field || state === 'closed') line()
	return rows
}

export const parseInboxCsv = (raw: string): InboxCsvRow[] => {
	if (new TextEncoder().encode(raw).byteLength > INBOX_CSV_MAX_BYTES)
		throw new InboxCsvError('Размер файла не должен превышать 1 МБ.')
	const text = raw.replace(/^\uFEFF/, '')
	if (!text.trim()) throw new InboxCsvError('Файл пуст.')
	if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(text))
		throw new InboxCsvError(
			'Сохраните файл как CSV в кодировке UTF-8 без управляющих символов.'
		)
	const [header, ...body] = records(text, delimiter(text))
	if (!header) throw new InboxCsvError('Отсутствует строка заголовков.')
	const keys = header.map(value => {
		const normalized = value.trim().toLowerCase()
		return Object.hasOwn(columns, normalized)
			? columns[normalized]
			: undefined
	})
	if (
		keys.some(key => !key) ||
		new Set(keys).size !== keys.length ||
		!keys.includes('title') ||
		!keys.includes('name')
	)
		throw new InboxCsvError(
			'Заголовки: title, name, phone, email, message. Обязательны title и name; повторяющиеся или неизвестные колонки не поддерживаются.'
		)
	if (!body.length)
		throw new InboxCsvError('После заголовка нет обращений.')
	return body.map((values, index) => {
		const rowNumber = index + 2
		if (values.length !== keys.length)
			throw new InboxCsvError(
				'Число полей не совпадает с заголовком.',
				rowNumber
			)
		const mapped: Record<string, string> = Object.fromEntries(
			keys.map((key, column) => [key, values[column].trim()])
		)
		const row = {
			title: mapped.title,
			name: mapped.name,
			phone: mapped.phone || null,
			email: mapped.email?.toLowerCase() || null,
			message: mapped.message || null
		}
		if (
			!row.title ||
			row.title.length > 200 ||
			!row.name ||
			row.name.length > 200
		)
			throw new InboxCsvError(
				'Укажите тему и имя длиной до 200 символов.',
				rowNumber
			)
		if (row.phone && !/^\+[1-9][0-9]{6,14}$/.test(row.phone))
			throw new InboxCsvError(
				'Телефон должен быть в международном формате, например +79001234567.',
				rowNumber
			)
		if (
			row.email &&
			(row.email.length > 254 ||
				!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
		)
			throw new InboxCsvError('Проверьте email.', rowNumber)
		if (row.message && row.message.length > 5000)
			throw new InboxCsvError(
				'Сообщение не должно превышать 5000 символов.',
				rowNumber
			)
		return row
	})
}

export const inboxCsvTemplate =
	'\uFEFFtitle;name;phone;email;message\r\nЗапрос стоимости;Иван Петров;+79001234567;ivan@example.com;Позвонить после 12:00\r\n'

export const readInboxCsvFile = async (
	file: Pick<File, 'size' | 'arrayBuffer'>
) => {
	if (file.size > INBOX_CSV_MAX_BYTES)
		throw new InboxCsvError('Размер файла не должен превышать 1 МБ.')
	let bytes: ArrayBuffer
	try {
		bytes = await file.arrayBuffer()
	} catch {
		throw new InboxCsvError(
			'Не удалось прочитать файл. Выберите его ещё раз.'
		)
	}
	if (bytes.byteLength > INBOX_CSV_MAX_BYTES)
		throw new InboxCsvError('Размер файла не должен превышать 1 МБ.')
	let text: string
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		throw new InboxCsvError('Сохраните файл как CSV в кодировке UTF-8.')
	}
	return parseInboxCsv(text)
}
