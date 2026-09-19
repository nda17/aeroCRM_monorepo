import { describe, expect, it, vi } from 'vitest'
import {
	INBOX_CSV_MAX_ROWS,
	inboxCsvTemplate,
	parseInboxCsv,
	readInboxCsvFile
} from './inbox-csv'

describe('Bounded UTF-8 Inbox CSV parser', () => {
	it('checks file size before reading and strictly rejects malformed UTF-8 bytes', async () => {
		const read = vi.fn()
		await expect(
			readInboxCsvFile({ size: 1024 * 1024 + 1, arrayBuffer: read })
		).rejects.toThrow(/1 МБ/)
		expect(read).not.toHaveBeenCalled()
		await expect(
			readInboxCsvFile({
				size: 2,
				arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer
			})
		).rejects.toThrow(/UTF-8/)
	})
	it('reads the local UTF-8 template without retaining a filename', async () => {
		const bytes = new TextEncoder().encode(inboxCsvTemplate)
		expect(
			await readInboxCsvFile({
				size: bytes.length,
				arrayBuffer: async () => bytes.buffer
			})
		).toEqual(parseInboxCsv(inboxCsvTemplate))
	})
	it('does not expose local read errors or paths', async () => {
		await expect(
			readInboxCsvFile({
				size: 10,
				arrayBuffer: async () => {
					throw new Error('/private/data.csv')
				}
			})
		).rejects.toThrow('Не удалось прочитать файл. Выберите его ещё раз.')
	})
	it('parses the downloadable UTF-8 BOM template', () => {
		expect(parseInboxCsv(inboxCsvTemplate)).toEqual([
			{
				title: 'Запрос стоимости',
				name: 'Иван Петров',
				phone: '+79001234567',
				email: 'ivan@example.com',
				message: 'Позвонить после 12:00'
			}
		])
	})
	it('supports comma, quoted delimiters, escaped quotes and embedded newlines', () => {
		expect(
			parseInboxCsv(
				'title,name,message\r\n"Заказ, срочно","Иван ""Иваныч""","Первая\r\nВторая"\r\n'
			)
		).toEqual([
			{
				title: 'Заказ, срочно',
				name: 'Иван "Иваныч"',
				phone: null,
				email: null,
				message: 'Первая\r\nВторая'
			}
		])
	})
	it('accepts documented Russian headers and trims data without evaluating it', () => {
		expect(
			parseInboxCsv('Тема;Имя;EMAIL\n =1+1 ; Иван ; USER@EXAMPLE.COM\n')[0]
		).toEqual({
			title: '=1+1',
			name: 'Иван',
			phone: null,
			email: 'user@example.com',
			message: null
		})
	})
	it('preserves explicit empty optional fields and ignores blank lines', () => {
		expect(
			parseInboxCsv('title,name,phone,email,message\n\nТема,Имя,,,\n\n')
		).toHaveLength(1)
	})
	it.each([
		'',
		'title,name',
		'title,name\nТема',
		'title,name\nТема,Имя,лишнее',
		'title,title\nТема,Имя',
		'title,Имя,name\nТема,Имя,Дубль',
		'title,name,password\nТема,Имя,значение',
		'title;name,email\nТема;Имя,email',
		'title,name\n"Тема,Имя',
		'title,name\nТе"ма,Имя',
		'title,name\n"Тема"suffix,Имя',
		'title,name\nТема,\u0000',
		'title,name\nТема,\uFFFD',
		'title,name\n,Имя'
	])(
		'rejects malformed or ambiguous CSV without partially importing: %s',
		value => expect(() => parseInboxCsv(value)).toThrow()
	)
	it.each(['89991234567', '+0123456789', 'tel:+79001234567'])(
		'does not silently normalize ambiguous phone %s',
		phone =>
			expect(() =>
				parseInboxCsv(`title,name,phone\nТема,Имя,${phone}`)
			).toThrow(/Телефон/)
	)
	it.each(['constructor', '__proto__', 'toString'])(
		'rejects prototype-like header %s',
		header =>
			expect(() =>
				parseInboxCsv(`title,name,${header}\nТема,Имя,value`)
			).toThrow(/Заголовки/)
	)
	it('enforces safe string limits and byte budget', () => {
		expect(() =>
			parseInboxCsv(`title,name\n${'a'.repeat(201)},Имя`)
		).toThrow(/200/)
		expect(() =>
			parseInboxCsv(`title,name,message\nТема,Имя,${'x'.repeat(5001)}`)
		).toThrow(/5000/)
		expect(() => parseInboxCsv('Я'.repeat(600000))).toThrow(/1 МБ/)
	})
	it('rejects the whole file when any row is invalid, reporting the record number but not PII', () => {
		expect(() =>
			parseInboxCsv(
				'title,name,email\nТема,Иван,a@example.com\nТема,Пётр,private-invalid-value'
			)
		).toThrow('Строка 3: Проверьте email.')
	})
	it('accepts the maximum batch and rejects one more record', () => {
		const valid =
			'title,name\n' +
			Array.from({ length: INBOX_CSV_MAX_ROWS }, () => 'Тема,Имя').join(
				'\n'
			)
		expect(parseInboxCsv(valid)).toHaveLength(INBOX_CSV_MAX_ROWS)
		expect(() => parseInboxCsv(`${valid}\nТема,Имя`)).toThrow(/250/)
	})
})
