import { describe, expect, it } from 'vitest'
import {
	normalizeCompanyName,
	parseWorkspaceBranding
} from './branding.contract'

const request = {
	workspaceId: '11111111-1111-4111-8111-111111111111',
	subject: 'owner'
}
const response = () => ({
	schemaVersion: 1,
	...request,
	branding: {
		displayName: 'Север',
		version: 1,
		updatedAt: '2026-09-07T10:00:00.000Z'
	}
})
describe('company caption contract', () => {
	it('normalizes NFC/outer spaces, preserves internal spaces and accepts an empty removal', () => {
		expect(normalizeCompanyName('  Студия  Севе\u0301р  ')).toBe(
			'Студия  Севе́р'
		)
		expect(normalizeCompanyName('  ')).toBeNull()
		expect(normalizeCompanyName(null)).toBeNull()
		expect(normalizeCompanyName('e\u0301')).toBe('é')
	})
	it('limits Unicode code points without slicing surrogate pairs', () => {
		expect(normalizeCompanyName('😀'.repeat(40))).toBe('😀'.repeat(40))
		expect(normalizeCompanyName('😀'.repeat(41))).toBeUndefined()
		expect(normalizeCompanyName('Я'.repeat(41))).toBeUndefined()
	})
	it.each([
		'<b>Brand</b>',
		'Brand\n',
		'a\u0000b',
		'a\u202Eb',
		'a\u200Db',
		'\uD800',
		42,
		{},
		undefined
	])('rejects hidden/HTML/non-text input %#', value => {
		expect(normalizeCompanyName(value)).toBeUndefined()
	})
	it('accepts a saved name, absent row and removal with retained version', () => {
		expect(parseWorkspaceBranding(response(), request)).not.toBeNull()
		expect(
			parseWorkspaceBranding(
				{
					...response(),
					branding: { displayName: null, version: 0, updatedAt: null }
				},
				request
			)
		).not.toBeNull()
		expect(
			parseWorkspaceBranding(
				{
					...response(),
					branding: { ...response().branding, displayName: null }
				},
				request
			)
		).not.toBeNull()
	})
	it.each([
		{ subject: 'another' },
		{ workspaceId: '22222222-2222-4222-8222-222222222222' },
		{ schemaVersion: 2 },
		{ surprise: true },
		{ commandId: 'unexpected' },
		{ branding: { ...response().branding, displayName: '<b>name</b>' } },
		{ branding: { ...response().branding, displayName: 'a'.repeat(41) } },
		{ branding: { ...response().branding, displayName: ' spaced ' } },
		{ branding: { ...response().branding, displayName: '' } },
		{ branding: { ...response().branding, version: 0 } },
		{ branding: { ...response().branding, version: -1 } },
		{ branding: { ...response().branding, version: 2147483648 } },
		{ branding: { ...response().branding, updatedAt: null } }
	])('rejects malformed or foreign response %#', patch => {
		expect(
			parseWorkspaceBranding({ ...response(), ...patch }, request)
		).toBeNull()
	})
	it('binds POST receipt to its exact command ID', () => {
		const commandId = '22222222-2222-4222-8222-222222222222'
		expect(
			parseWorkspaceBranding(
				{ ...response(), commandId },
				{ ...request, commandId }
			)
		).not.toBeNull()
		expect(
			parseWorkspaceBranding(response(), { ...request, commandId })
		).toBeNull()
		expect(
			parseWorkspaceBranding(
				{ ...response(), commandId: request.workspaceId },
				{ ...request, commandId }
			)
		).toBeNull()
	})
})
