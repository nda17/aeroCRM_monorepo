import { describe, expect, it } from 'vitest'
import { isLookupInn, parseCompanyLookup } from './company-lookup.contract'

const inn = '7707083893'
const item = {
	name: 'Компания',
	legalName: 'Полное название компании',
	inn,
	kpp: '770701001',
	ogrn: '1027700132195',
	legalAddress: 'Москва',
	entityType: 'LEGAL',
	status: 'ACTIVE'
}
const result = {
	schemaVersion: 1,
	provider: 'DADATA',
	queriedAt: '2026-09-07T12:00:00.000Z',
	inn,
	items: [item]
}

describe('company lookup exact contract', () => {
	it('accepts another bounded provider code without changing the requisites contract', () => {
		const other = { ...result, provider: 'OTHER_PROVIDER' }
		expect(parseCompanyLookup(other, inn)).toEqual(other)
	})
	it.each(['7707083893', '500100732259'])(
		'accepts a valid checksum: %s',
		value => expect(isLookupInn(value)).toBe(true)
	)
	it.each([
		'0000000000',
		'000000000000',
		'7707083894',
		'500100732258',
		'770708389',
		'77070838930',
		' 7707083893',
		'7707-083893',
		''
	])('rejects invalid lookup INN: %s', value =>
		expect(isLookupInn(value)).toBe(false)
	)
	it('accepts the bounded, exact legal company response and confirmed empty result', () => {
		expect(parseCompanyLookup(result, inn)).toEqual(result)
		expect(
			parseCompanyLookup({ ...result, items: [] }, inn)?.items
		).toEqual([])
	})
	it('accepts an individual entrepreneur only with matching INN and nullable KPP', () => {
		const individualInn = '500100732259'
		const individual = {
			...item,
			inn: individualInn,
			kpp: null,
			ogrn: '304500116000157',
			entityType: 'INDIVIDUAL'
		}
		const response = { ...result, inn: individualInn, items: [individual] }
		expect(parseCompanyLookup(response, individualInn)).toEqual(response)
		for (const patch of [
			{ kpp: '770701001' },
			{ ogrn: item.ogrn },
			{ entityType: 'LEGAL' }
		])
			expect(
				parseCompanyLookup(
					{ ...response, items: [{ ...individual, ...patch }] },
					individualInn
				)
			).toBeNull()
	})
	it.each([
		{ ...result, secret: 'not-public' },
		{ ...result, provider: 'unknown provider' },
		{ ...result, provider: 'A' },
		{ ...result, provider: 'A'.repeat(33) },
		{ ...result, provider: '<script>' },
		{ ...result, schemaVersion: 2 },
		{ ...result, queriedAt: 'today' },
		{ ...result, inn: '500100732259' },
		{ ...result, items: Array(6).fill(item) },
		{ ...result, items: [item, item] },
		...[
			{ token: 'not-public' },
			{ legalName: '' },
			{ name: 'x'.repeat(201) },
			{ legalName: 'x'.repeat(2001) },
			{ legalAddress: 'x'.repeat(2001) },
			{ inn: '500100732259' },
			{ kpp: '123' },
			{ ogrn: '304500116000157' },
			{ entityType: 'INDIVIDUAL' },
			{ status: 'NEW' }
		].map(patch => ({ ...result, items: [{ ...item, ...patch }] }))
	])(
		'rejects additional, mismatched and malformed provider data',
		value => {
			expect(parseCompanyLookup(value, inn)).toBeNull()
		}
	)
})
