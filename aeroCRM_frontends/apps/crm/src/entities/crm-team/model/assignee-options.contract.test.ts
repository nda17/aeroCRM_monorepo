import { describe, expect, it } from 'vitest'
import {
	assigneeDisplayName,
	parseAssigneeOptions,
	validAssigneeOptionsRequest,
	type AssigneeOption,
	type AssigneeOptionsRequest
} from './assignee-options.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const request: AssigneeOptionsRequest = {
	workspaceId,
	subject: 'owner',
	dataScope: 'ALL',
	page: 1,
	pageSize: 20
}
const employee: AssigneeOption = {
	subject: 'employee',
	membershipId: '22222222-2222-4222-8222-222222222222',
	displayName: 'Иван Петров',
	verifiedEmail: 'ivan@example.com',
	role: 'MANAGER'
}
const owner: AssigneeOption = {
	subject: 'owner',
	membershipId: '33333333-3333-4333-8333-333333333333',
	displayName: null,
	verifiedEmail: null,
	role: 'OWNER'
}
const result = {
	schemaVersion: 1,
	workspaceId,
	subject: 'owner',
	page: 1,
	pageSize: 20,
	total: 1,
	items: [employee],
	selected: null
}

describe('scoped assignee options contract', () => {
	it('accepts the bounded server page and an owner binding without a CRM member row', () => {
		expect(parseAssigneeOptions(result, request)).toEqual(result)
		const emptySearch = { ...result, total: 0, items: [], selected: owner }
		expect(
			parseAssigneeOptions(emptySearch, {
				...request,
				search: 'Петров',
				selectedSubject: owner.subject
			})
		).toEqual(emptySearch)
	})
	it('accepts selected outside the search page, with plain text and nullable display fields', () => {
		const selected = { ...owner, displayName: '  <b>Бренд</b>  ' }
		const page = { ...result, page: 2, total: 21, selected }
		expect(
			parseAssigneeOptions(page, {
				...request,
				page: 2,
				selectedSubject: 'owner'
			})
		).toEqual(page)
	})
	it.each([
		{ ...result, schemaVersion: 2 },
		{ ...result, workspaceId: owner.membershipId },
		{ ...result, subject: 'someone-else' },
		{ ...result, page: 2 },
		{ ...result, pageSize: 100 },
		{ ...result, total: -1 },
		{ ...result, total: 10002 },
		{ ...result, total: 0 },
		{ ...result, total: 2 },
		{ ...result, total: 1.5 },
		{ ...result, selected: owner },
		{ ...result, extra: true },
		{ ...result, selected: undefined },
		{ ...result, items: [{ ...employee, membershipId: null }] },
		{ ...result, items: [{ ...employee, membershipId: 'guessed' }] },
		{ ...result, items: [{ ...employee, subject: 'spaces not allowed' }] },
		{ ...result, items: [{ ...employee, role: 'ANALYST' }] },
		{
			...result,
			items: [{ ...employee, verifiedEmail: 'Ivan@example.com' }]
		},
		{ ...result, items: [{ ...employee, verifiedEmail: 'invalid' }] },
		{
			...result,
			items: [{ ...employee, verifiedEmail: ' ivan@example.com' }]
		},
		{ ...result, items: [{ ...employee, displayName: 'x'.repeat(1001) }] },
		{
			...result,
			items: [{ ...employee, privateField: 'not-in-contract' }]
		}
	])('rejects malformed or differently bound responses %#', value => {
		expect(parseAssigneeOptions(value, request)).toBeNull()
	})
	it('rejects duplicate subjects and memberships, including selected collisions', () => {
		for (const duplicate of [
			employee,
			{ ...owner, membershipId: employee.membershipId },
			{ ...employee, membershipId: owner.membershipId }
		]) {
			expect(
				parseAssigneeOptions(
					{ ...result, total: 2, items: [employee, duplicate] },
					request
				)
			).toBeNull()
		}
		expect(
			parseAssigneeOptions(
				{
					...result,
					selected: { ...owner, membershipId: employee.membershipId }
				},
				{
					...request,
					selectedSubject: 'owner'
				}
			)
		).toBeNull()
	})
	it('requires selected and on-page bindings to agree exactly', () => {
		const selectedRequest = {
			...request,
			selectedSubject: employee.subject
		}
		expect(
			parseAssigneeOptions(
				{ ...result, selected: employee },
				selectedRequest
			)
		).not.toBeNull()
		for (const selected of [
			null,
			owner,
			{ ...employee, membershipId: owner.membershipId },
			{ ...employee, displayName: 'Другое имя' },
			{ ...employee, role: 'CRM_ADMIN' }
		]) {
			expect(
				parseAssigneeOptions({ ...result, selected }, selectedRequest)
			).toBeNull()
		}
	})
	it('does not accept multiple owners or foreign OWN-scope entries', () => {
		expect(
			parseAssigneeOptions(
				{
					...result,
					total: 2,
					items: [owner, { ...employee, role: 'OWNER' }]
				},
				request
			)
		).toBeNull()
		expect(
			parseAssigneeOptions(result, { ...request, dataScope: 'OWN' })
		).toBeNull()
		expect(
			parseAssigneeOptions(
				{ ...result, items: [owner] },
				{ ...request, dataScope: 'TEAM' }
			)
		).toBeNull()
		const own = { ...result, subject: employee.subject }
		expect(
			parseAssigneeOptions(own, {
				...request,
				subject: employee.subject,
				dataScope: 'OWN'
			})
		).toEqual(own)
	})
	it.each([
		{ ...request, workspaceId: '' },
		{ ...request, subject: '' },
		{ ...request, page: 0 },
		{ ...request, page: 1000001 },
		{ ...request, pageSize: 0 },
		{ ...request, pageSize: 101 },
		{ ...request, search: 'x'.repeat(201) },
		{ ...request, selectedSubject: 'bad\nsubject' },
		{ ...request, teamId: 'fake' }
	])('rejects invalid request parameters %#', value => {
		expect(validAssigneeOptionsRequest(value)).toBe(false)
		expect(parseAssigneeOptions(result, value)).toBeNull()
	})
	it('uses display name, then verified email, then a non-identifying role fallback', () => {
		expect(assigneeDisplayName(employee)).toBe('Иван Петров')
		expect(assigneeDisplayName({ ...employee, displayName: '   ' })).toBe(
			'ivan@example.com'
		)
		expect(assigneeDisplayName(owner)).toBe('Владелец пространства')
		expect(
			assigneeDisplayName({
				...employee,
				displayName: null,
				verifiedEmail: null
			})
		).toBe('Сотрудник без имени')
	})
})
