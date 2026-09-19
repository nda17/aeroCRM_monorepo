import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	browserWorkdayTimeZones,
	workdayTimeZoneGroups
} from './workday-time-zones'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
const options = (current: string, zones: readonly string[] | null) =>
	workdayTimeZoneGroups(current, zones).flatMap(group => group.options)

describe('planner timezone choices', () => {
	it('offers Russian city labels and all browser-supported IANA zones without duplicates', () => {
		const zones = browserWorkdayTimeZones()
		const result = options('Asia/Vladivostok', zones)
		expect(
			result.find(option => option.value === 'Asia/Vladivostok')
		).toEqual({
			value: 'Asia/Vladivostok',
			label: 'Владивосток'
		})
		expect(
			result.find(option => option.value === 'Europe/London')?.label
		).toBe('Лондон')
		const values = result.map(option => option.value)
		expect(new Set(values).size).toBe(values.length)
		for (const zone of zones) expect(values).toContain(zone)
	})
	it.each(['US/Eastern', 'Etc/GMT-3', 'Antarctica/Troll'])(
		'preserves the exact valid saved value %s even when absent from the catalog',
		current => {
			const selected = options(current, ['Europe/Moscow']).find(
				option => option.value === current
			)
			expect(selected).toEqual({
				value: current,
				label: current,
				disabled: false
			})
		}
	)
	it('keeps invalid saved data disabled and never adds unknown advertised zones', () => {
		const result = options('not/a-timezone', [
			'not/another-zone',
			'UTC',
			'UTC'
		])
		expect(
			result.find(option => option.value === 'not/a-timezone')?.disabled
		).toBe(true)
		expect(
			result.some(option => option.value === 'not/another-zone')
		).toBe(false)
	})
	it('uses a deterministic SSR catalog without reading runtime timezone support', () => {
		const runtime = vi
			.spyOn(Intl, 'DateTimeFormat')
			.mockImplementation(() => {
				throw Error('SSR must not validate with runtime ICU')
			})
		const result = options('US/Eastern', null)
		expect(runtime).not.toHaveBeenCalled()
		expect(result.find(option => option.value === 'US/Eastern')).toEqual({
			value: 'US/Eastern',
			label: 'US/Eastern',
			disabled: true
		})
	})
	it.each(['missing', 'throwing'])(
		'retains popular choices and valid aliases when supportedValuesOf is %s',
		mode => {
			if (mode === 'missing')
				vi.stubGlobal('Intl', { DateTimeFormat: Intl.DateTimeFormat })
			else
				vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
					throw Error('Not supported')
				})
			expect(browserWorkdayTimeZones()).toEqual([])
			const result = options('US/Eastern', browserWorkdayTimeZones())
			expect(
				result.find(option => option.value === 'US/Eastern')?.disabled
			).toBe(false)
			expect(
				result.some(option => option.value === 'Asia/Vladivostok')
			).toBe(true)
		}
	)
})
