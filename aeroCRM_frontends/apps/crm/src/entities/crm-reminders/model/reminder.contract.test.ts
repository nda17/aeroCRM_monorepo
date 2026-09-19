import { describe, expect, it } from 'vitest'
import {
	parseReminderPage,
	parseReminderResult,
	parseReminderRule,
	type ReminderCommand,
	type ReminderPageRequest,
	type ReminderRule
} from './reminder.contract'
const id = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const actor = { subject: 'owner', membershipId: null }
const rule: ReminderRule = {
	schemaVersion: 1,
	id,
	scope: 'PERSONAL',
	ownerBinding: actor,
	title: 'Срок задачи',
	enabled: false,
	channels: ['EMAIL'],
	trigger: { kind: 'BEFORE_DUE', offsetMinutes: 60 },
	repeats: null,
	timeZone: 'Asia/Vladivostok',
	quietHours: null,
	recipients: { kind: 'SELF' }
}
const item = {
	workspaceId,
	rule,
	version: 1,
	archivedAt: null,
	createdAt: '2026-09-07T00:00:00.000Z',
	updatedAt: '2026-09-07T00:00:00.000Z'
}
const request: ReminderPageRequest = {
	workspaceId,
	actor,
	scope: 'PERSONAL',
	archived: false,
	page: 1,
	pageSize: 10
}
const page = {
	schemaVersion: 1,
	workspaceId,
	page: 1,
	pageSize: 10,
	total: 1,
	items: [item],
	limits: { PERSONAL: 10, WORKSPACE: 20 },
	deliveryReady: false
}
describe('reminder v1 contract', () => {
	it('accepts assignment rules only with zero offset and no repetitions', () => {
		const assigned = {
			...rule,
			trigger: { kind: 'ASSIGNED', offsetMinutes: 0 }
		}
		expect(parseReminderRule(assigned)).not.toBeNull()
		expect(
			parseReminderRule({
				...assigned,
				trigger: { kind: 'ASSIGNED', offsetMinutes: 60 }
			})
		).toBeNull()
		expect(
			parseReminderRule({
				...assigned,
				repeats: { intervalMinutes: 60, count: 2 }
			})
		).toBeNull()
	})
	it('accepts explicit disabled settings, owner null and IANA aliases/overnight quiet hours', () => {
		expect(parseReminderRule(rule)).toEqual(rule)
		expect(
			parseReminderRule({
				...rule,
				timeZone: 'US/Eastern',
				quietHours: { start: '22:00', end: '08:00' },
				repeats: { intervalMinutes: 15, count: 2 }
			})
		).not.toBeNull()
		expect(parseReminderPage(page, request)).not.toBeNull()
	})
	it.each([
		{ enabled: undefined },
		{ enabled: 'false' },
		{ channels: ['EMAIL', 'EMAIL'] },
		{ channels: [], enabled: true },
		{ timeZone: '+10:00' },
		{ timeZone: 'Mars/Base' },
		{ timeZone: '' },
		{ quietHours: { start: '22:00', end: '22:00' } },
		{ quietHours: { start: '24:00', end: '08:00' } },
		{ trigger: { kind: 'AT_DUE', offsetMinutes: 1 } },
		{ trigger: { kind: 'BEFORE_DUE', offsetMinutes: 0 } },
		{ trigger: { kind: 'AFTER_DUE', offsetMinutes: 43201 } },
		{ repeats: { intervalMinutes: 14, count: 2 } },
		{ repeats: { intervalMinutes: 15, count: 1001 } },
		{ recipients: { kind: 'WORKSPACE' } },
		{ title: ' ' },
		{ title: 'a'.repeat(121) },
		{ ownerBinding: { subject: 'owner', membershipId: 'any' } },
		{ destinationEmail: 'private@example.test' }
	])('rejects invalid or extra fields %j', patch =>
		expect(parseReminderRule({ ...rule, ...patch })).toBeNull()
	)
	it('requires exact distinct selected bindings and excludes SELF for workspace rules', () => {
		expect(
			parseReminderRule({
				...rule,
				scope: 'WORKSPACE',
				recipients: { kind: 'SELECTED', bindings: [actor] }
			})
		).not.toBeNull()
		for (const recipients of [
			{ kind: 'SELF' },
			{ kind: 'SELECTED', bindings: [] },
			{ kind: 'SELECTED', bindings: [actor, actor] },
			{ kind: 'ASSIGNEE', bindings: [] }
		])
			expect(
				parseReminderRule({ ...rule, scope: 'WORKSPACE', recipients })
			).toBeNull()
	})
	it.each([
		{ workspaceId: id },
		{ page: 2 },
		{ total: 11 },
		{
			items: [
				{
					...item,
					rule: { ...rule, ownerBinding: { ...actor, subject: 'another' } }
				}
			]
		},
		{ items: [{ ...item, archivedAt: item.createdAt }] },
		{ deliveryReady: 'false' },
		{ limits: { PERSONAL: 100, WORKSPACE: 20 } },
		{ subject: 'extra' }
	])('binds server pages to actor/scope/archived/limits %j', patch =>
		expect(parseReminderPage({ ...page, ...patch }, request)).toBeNull()
	)
	it('validates exact CAS result including payload and archive status, with future delivery readiness boolean', () => {
		const command: ReminderCommand = {
			commandId: workspaceId,
			workspaceId,
			actor,
			action: 'edit',
			rule,
			expectedVersion: 1
		}
		const result = {
			schemaVersion: 1,
			item: { ...item, version: 2 },
			deliveryReady: true
		}
		expect(parseReminderResult(result, command)).not.toBeNull()
		for (const changed of [
			{ ...item, version: 3 },
			{ ...item, version: 2, rule: { ...rule, enabled: true } },
			{ ...item, version: 2, archivedAt: item.createdAt }
		])
			expect(
				parseReminderResult({ ...result, item: changed }, command)
			).toBeNull()
	})
})
