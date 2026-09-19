import { describe, expect, it } from 'vitest'
import {
	deviceTimeZone,
	taskDueIso,
	taskLocalDate,
	workdayDateLabel
} from './workday-form'

describe('Workday device-local date editing', () => {
	it('preserves an untouched original instant including seconds and milliseconds', () => {
		const iso = '2026-09-07T12:30:42.123Z'
		const local = taskLocalDate(iso)
		expect(taskDueIso(local, { local, iso })).toBe(iso)
		expect(taskDueIso(local)).toBe(
			new Date(new Date(iso).setSeconds(0, 0)).toISOString()
		)
		expect(deviceTimeZone()).toBe(
			Intl.DateTimeFormat().resolvedOptions().timeZone
		)
	})
	it.each([
		'',
		'2026-02-30T12:00',
		'2026-02-29T12:00',
		'2026-13-01T12:00',
		'2026-00-01T12:00',
		'2026-09-00T12:00',
		'2026-09-01T24:00',
		'2026-09-01T12:60',
		'0099-09-01T12:00',
		'2026-9-1T12:00',
		'2026-09-01T12:00Z',
		'2026-09-01T12:00:30',
		'2026-09-01'
	])('rejects invalid local value %s', value => {
		expect(taskDueIso(value)).toBeNull()
	})
	it('accepts a real leap day and returns a canonical ISO instant', () => {
		const parsed = taskDueIso('2028-02-29T12:35')!
		expect(parsed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/)
		expect(taskLocalDate(parsed)).toBe('2028-02-29T12:35')
		expect(taskLocalDate('invalid')).toBe('')
	})
	it('preserves both untouched instants of an autumn DST fold', () => {
		for (const iso of [
			'2026-11-01T05:30:40.012Z',
			'2026-11-01T06:30:40.012Z'
		]) {
			const local = taskLocalDate(iso)
			expect(taskDueIso(local, { local, iso })).toBe(iso)
		}
	})
	// Also run this test suite with TZ=America/New_York to exercise native Date's
	// nonexistent spring local time without overriding Intl or the Date runtime.
	it.skipIf(deviceTimeZone() !== 'America/New_York')(
		'rejects the device DST spring gap, but permits adjacent times',
		() => {
			expect(taskDueIso('2026-03-08T02:30')).toBeNull()
			expect(taskDueIso('2026-03-08T01:30')).toBe(
				'2026-03-08T06:30:00.000Z'
			)
			expect(taskDueIso('2026-03-08T03:30')).toBe(
				'2026-03-08T07:30:00.000Z'
			)
		}
	)
	it('renders an explicit display timezone without treating it as the input timezone', () => {
		const iso = '2026-09-07T12:30:00.000Z'
		expect(workdayDateLabel(iso, 'Europe/Moscow')).toContain('15:30')
		expect(workdayDateLabel(iso, 'invalid')).toBe(iso)
	})
})
