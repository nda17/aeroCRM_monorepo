import { describe, expect, it } from 'vitest'
import { contactCallState } from './contact-call'

describe('client local call window', () => {
	it('uses the client timezone with inclusive start, exclusive end and no device timezone', () => {
		const p = {
			timeZone: 'Asia/Vladivostok',
			preferredCallStart: '09:00',
			preferredCallEnd: '18:00'
		}
		expect(
			contactCallState(p, new Date('2026-09-07T22:59:00Z')).status
		).toBe('OUTSIDE')
		expect(
			contactCallState(p, new Date('2026-09-07T23:00:00Z')).status
		).toBe('ALLOWED')
		expect(
			contactCallState(p, new Date('2026-09-08T08:00:00Z')).status
		).toBe('OUTSIDE')
	})
	it('supports overnight hours and leaves absent timezone/hours explicitly unknown', () => {
		const p = {
			timeZone: 'UTC',
			preferredCallStart: '22:00',
			preferredCallEnd: '06:00'
		}
		expect(
			contactCallState(p, new Date('2026-09-07T23:00:00Z')).status
		).toBe('ALLOWED')
		expect(
			contactCallState(p, new Date('2026-09-07T05:59:00Z')).status
		).toBe('ALLOWED')
		expect(
			contactCallState(p, new Date('2026-09-07T06:00:00Z')).status
		).toBe('OUTSIDE')
		expect(
			contactCallState(
				{
					timeZone: null,
					preferredCallStart: null,
					preferredCallEnd: null
				},
				new Date()
			).status
		).toBe('UNKNOWN')
		expect(
			contactCallState(
				{ ...p, preferredCallStart: null, preferredCallEnd: null },
				new Date()
			).status
		).toBe('UNKNOWN')
	})
})
