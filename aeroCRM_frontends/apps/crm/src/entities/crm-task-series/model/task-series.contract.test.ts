import { describe, expect, it } from 'vitest'
import {
	parseSeriesPage,
	parseSeriesResult,
	parseTaskSeries,
	validSeriesCommand,
	validSeriesDate
} from './task-series.contract'
import {
	command,
	page,
	request,
	row,
	seriesId,
	workspaceId
} from './task-series.test-fixtures'

describe('task series exact contract', () => {
	it('accepts service-owned rows, pagination and command results', () => {
		expect(parseTaskSeries(row, workspaceId)).toEqual(row)
		expect(parseSeriesPage(page, request)).toEqual(page)
		expect(
			parseSeriesResult({ schemaVersion: 1, series: row }, command)
		).toEqual(row)
	})
	it.each([
		{ workspaceId: seriesId },
		{ status: 'UNKNOWN' },
		{ assignee: { subject: 'actor', membershipId: 'wrong' } },
		{ startDate: '2026-02-30' },
		{ timeZone: 'Unknown/Zone' },
		{ localTime: '25:00' },
		{ private: 'extra' }
	])('rejects malformed or foreign row %j', patch => {
		expect(parseTaskSeries({ ...row, ...patch }, workspaceId)).toBeNull()
	})
	it('rejects cross-status, duplicate and impossible page sizes', () => {
		expect(
			parseSeriesPage(
				{ ...page, items: [{ ...row, status: 'PAUSED' }] },
				request
			)
		).toBeNull()
		expect(
			parseSeriesPage({ ...page, total: 2, items: [row, row] }, request)
		).toBeNull()
		expect(parseSeriesPage({ ...page, total: 11 }, request)).toBeNull()
	})
	it('pins id, version, content and requested status in the response', () => {
		const status = {
			...command,
			mutation: {
				kind: 'status' as const,
				id: row.id,
				expectedVersion: 1,
				status: 'PAUSED' as const
			}
		}
		expect(
			parseSeriesResult(
				{
					schemaVersion: 1,
					series: { ...row, version: 2, status: 'PAUSED' }
				},
				status
			)
		).not.toBeNull()
		expect(
			parseSeriesResult(
				{
					schemaVersion: 1,
					series: { ...row, version: 2, status: 'ACTIVE' }
				},
				status
			)
		).toBeNull()
		expect(
			parseSeriesResult(
				{ schemaVersion: 1, series: { ...row, title: 'Other' } },
				command
			)
		).toBeNull()
	})
	it('validates calendar syntax without implementing a second recurrence scheduler', () => {
		expect(validSeriesDate('2028-02-29')).toBe(true)
		expect(validSeriesDate('2027-02-29')).toBe(false)
		expect(validSeriesCommand(command)).toBe(true)
		expect(validSeriesCommand({ ...command, sessionRevision: -1 })).toBe(
			false
		)
	})
})
