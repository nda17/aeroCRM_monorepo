import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadFile } from './download-file'

afterEach(() => vi.restoreAllMocks())
describe('Local validated Blob download', () => {
	it('uses a fixed name and revokes the object URL without persisting data', async () => {
		vi.useFakeTimers()
		const create = vi.fn(() => 'blob:bounded-download')
		const revoke = vi.fn()
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value: create
		})
		Object.defineProperty(URL, 'revokeObjectURL', {
			configurable: true,
			value: revoke
		})
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {})
		downloadFile(
			new Uint8Array([123, 125]),
			'wincrm-contacts.json',
			'application/json; charset=utf-8'
		)
		expect(click.mock.instances[0]).toHaveProperty(
			'download',
			'wincrm-contacts.json'
		)
		expect(document.querySelector('a[download]')).toBeNull()
		await vi.runAllTimersAsync()
		expect(revoke).toHaveBeenCalledWith('blob:bounded-download')
		vi.useRealTimers()
	})
	it.each([
		'../private.csv',
		'person@example.com.csv',
		'.hidden.json',
		'wincrm-contacts.html'
	])('rejects an unsafe filename %s', filename => {
		expect(() =>
			downloadFile(new Uint8Array(), filename, 'text/csv; charset=utf-8')
		).toThrow()
	})
})
