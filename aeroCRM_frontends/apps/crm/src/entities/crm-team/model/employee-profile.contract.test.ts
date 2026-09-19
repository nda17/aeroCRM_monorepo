import { describe, expect, it } from 'vitest'
import {
	normalizeEmployeeName,
	parseEmployeeProfile
} from './employee-profile.contract'

const request = {
	workspaceId: '11111111-1111-4111-8111-111111111111',
	subject: 'owner',
	targetSubject: 'employee'
}
const profile = {
	id: '22222222-2222-4222-8222-222222222222',
	firstName: 'Иван',
	lastName: 'Петров',
	middleName: null,
	version: 1,
	updatedAt: '2026-09-07T10:00:00.000Z'
}
const response = { ...request, schemaVersion: 1, profile }

describe('employee profile response binding', () => {
	it('accepts an explicit missing profile without inventing or splitting a name', () => {
		expect(
			parseEmployeeProfile({ ...response, profile: null }, request)
				?.profile
		).toBeNull()
		expect(parseEmployeeProfile(response, request)).toEqual(response)
	})
	it.each(['workspaceId', 'subject', 'targetSubject'])(
		'rejects a response for another %s',
		key => {
			expect(
				parseEmployeeProfile({ ...response, [key]: 'another' }, request)
			).toBeNull()
		}
	)
	it('rejects additional authority and unrecognized schema fields', () => {
		for (const value of [
			{ ...response, role: 'OWNER' },
			{ ...response, schemaVersion: 2 },
			{ ...response, profile: { ...profile, membershipId: profile.id } }
		])
			expect(parseEmployeeProfile(value, request)).toBeNull()
	})
	it.each([
		{ firstName: '' },
		{ firstName: ' Иван' },
		{ firstName: '<script>' },
		{ lastName: 'x'.repeat(101) },
		{ middleName: '' },
		{ middleName: 1 },
		{ version: 0 },
		{ version: 2147483648 },
		{ id: 'bad' },
		{ updatedAt: 'yesterday' }
	])('rejects malformed stored profile %j', patch => {
		expect(
			parseEmployeeProfile(
				{ ...response, profile: { ...profile, ...patch } },
				request
			)
		).toBeNull()
	})
	it('normalizes structured fields consistently with Access without guessing FIO', () => {
		expect(
			normalizeEmployeeName({
				firstName: ' Анна  Мария ',
				lastName: 'О’Коннор-Соколова',
				middleName: ''
			})
		).toEqual({
			firstName: 'Анна Мария',
			lastName: 'О’Коннор-Соколова',
			middleName: null
		})
		expect(
			normalizeEmployeeName({
				firstName: 'Анна\nМария',
				lastName: 'Петрова',
				middleName: null
			})
		).toBeNull()
	})
})
