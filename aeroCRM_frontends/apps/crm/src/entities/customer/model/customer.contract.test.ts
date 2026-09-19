import { describe, expect, it } from 'vitest'
import {
	parseCompanyV2,
	parseContactV2,
	parseCustomer,
	parseCustomerPage,
	parseCustomerResult
} from './customer.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const contact = {
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	name: 'Тестовый клиент',
	notes: null,
	createdBySubject: 'user-1',
	teamId: null,
	version: 1,
	archivedAt: null,
	createdAt: '2026-09-05T00:00:00.000Z',
	updatedAt: '2026-09-05T00:00:00.000Z',
	phone: '+79000000001',
	email: 'test@example.test',
	companyId: null
}
const page = {
	schemaVersion: 1,
	page: 1,
	pageSize: 25,
	total: 1,
	items: [contact]
}
describe('contact v2 call preference contract', () => {
	const v2 = {
		...contact,
		timeZone: 'Asia/Vladivostok',
		preferredCallStart: '09:00',
		preferredCallEnd: '18:00'
	}
	it('requires all three nullable fields and keeps v1 strict', () => {
		expect(parseContactV2(v2, workspaceId)).toMatchObject(v2)
		expect(parseContactV2(contact, workspaceId)).toBeNull()
		expect(parseCustomer(v2, 'contacts', workspaceId)).toBeNull()
		expect(
			parseContactV2(
				{
					...v2,
					timeZone: null,
					preferredCallStart: null,
					preferredCallEnd: null
				},
				workspaceId
			)
		).not.toBeNull()
		expect(
			parseContactV2(
				{
					...v2,
					timeZone: 'US/Eastern',
					preferredCallStart: '22:00',
					preferredCallEnd: '06:00'
				},
				workspaceId
			)
		).not.toBeNull()
	})
	it.each([
		{ timeZone: 'unknown' },
		{ timeZone: null },
		{ preferredCallStart: null },
		{ preferredCallStart: '24:00' },
		{ preferredCallStart: '18:00' },
		{ preferredCallEnd: undefined }
	])('rejects inconsistent preferences %j', patch => {
		expect(parseContactV2({ ...v2, ...patch }, workspaceId)).toBeNull()
	})
})
describe('customer exact contracts', () => {
	it('parses a contact without inventing DTO fields', () =>
		expect(parseCustomer(contact, 'contacts', workspaceId)).toEqual({
			...contact,
			kind: 'contacts'
		}))
	it.each([
		{ ...contact, unexpected: true },
		{ ...contact, workspaceId: '33333333-3333-4333-8333-333333333333' },
		{ ...contact, version: 0 },
		{ ...contact, phone: '79000000001' },
		{ ...contact, companyId: 'external-id' },
		{ ...contact, updatedAt: '2026-09-05' }
	])('rejects malformed/cross-workspace records', value =>
		expect(parseCustomer(value, 'contacts', workspaceId)).toBeNull()
	)
	it('parses an archive command but never lists archived records', () => {
		const archived = { ...contact, archivedAt: contact.updatedAt }
		expect(
			parseCustomerResult(
				{ schemaVersion: 1, contact: archived },
				'contacts',
				workspaceId,
				contact.id
			)?.archivedAt
		).toBe(contact.updatedAt)
		expect(
			parseCustomerPage(
				{ ...page, items: [archived] },
				'contacts',
				workspaceId,
				1,
				25
			)
		).toBeNull()
	})
	it('checks exact identity, pagination and duplicate list IDs', () => {
		expect(
			parseCustomerPage(page, 'contacts', workspaceId, 1, 25)?.items
		).toHaveLength(1)
		expect(
			parseCustomerPage(page, 'contacts', workspaceId, 2, 25)
		).toBeNull()
		expect(
			parseCustomerPage(
				{ ...page, total: 2, items: [contact, contact] },
				'contacts',
				workspaceId,
				1,
				25
			)
		).toBeNull()
		expect(
			parseCustomerResult(
				{ schemaVersion: 1, contact },
				'contacts',
				workspaceId,
				workspaceId
			)
		).toBeNull()
	})
	it('rejects unsafe company website protocols and embedded credentials', () => {
		const {
			phone: _phone,
			email: _email,
			companyId: _companyId,
			...base
		} = contact
		void _phone
		void _email
		void _companyId
		for (const website of [
			'javascript:alert(1)',
			'https://user:password@example.test',
			'file:///etc/passwd'
		])
			expect(
				parseCustomer(
					{ ...base, inn: null, website },
					'companies',
					workspaceId
				)
			).toBeNull()
		expect(
			parseCustomer(
				{ ...base, inn: '1234567890', website: 'https://example.test' },
				'companies',
				workspaceId
			)?.kind
		).toBe('companies')
	})
})

describe('additive company v2 contract', () => {
	const {
		phone: _phone,
		email: _email,
		companyId: _companyId,
		...base
	} = contact
	void _phone
	void _email
	void _companyId
	const legacy = { ...base, inn: '1234567890', website: null }
	const company = {
		...legacy,
		legalName: null,
		kpp: null,
		ogrn: null,
		legalAddress: null,
		entityType: null
	}
	it('keeps old v1 companies exact and accepts all required nullable v2 fields', () => {
		expect(parseCustomer(legacy, 'companies', workspaceId)).toEqual({
			...legacy,
			kind: 'companies'
		})
		expect(parseCustomer(company, 'companies', workspaceId)).toBeNull()
		expect(parseCompanyV2(legacy, workspaceId)).toBeNull()
		expect(parseCompanyV2(company, workspaceId)).toEqual({
			...company,
			kind: 'companies'
		})
	})
	it('binds version, workspace, ID, pagination and archive status', () => {
		const response = { schemaVersion: 2, company }
		expect(
			parseCustomerResult(
				response,
				'companies',
				workspaceId,
				company.id,
				2
			)?.id
		).toBe(company.id)
		expect(
			parseCustomerResult(response, 'companies', workspaceId, company.id)
		).toBeNull()
		expect(
			parseCustomerResult(
				response,
				'companies',
				workspaceId,
				workspaceId,
				2
			)
		).toBeNull()
		expect(
			parseCompanyV2({ ...company, workspaceId: company.id }, workspaceId)
		).toBeNull()
		const pageV2 = { ...page, schemaVersion: 2, items: [company] }
		expect(
			parseCustomerPage(pageV2, 'companies', workspaceId, 1, 25, 2)?.items
		).toHaveLength(1)
		expect(
			parseCustomerPage(pageV2, 'companies', workspaceId, 2, 25, 2)
		).toBeNull()
		expect(
			parseCustomerPage(
				{
					...pageV2,
					items: [{ ...company, archivedAt: company.updatedAt }]
				},
				'companies',
				workspaceId,
				1,
				25,
				2
			)
		).toBeNull()
		expect(
			parseCustomerPage(
				{ ...page, schemaVersion: 2 },
				'contacts',
				workspaceId,
				1,
				25,
				2
			)
		).toBeNull()
	})
	it.each([
		{ legalName: 'x'.repeat(2001) },
		{ legalAddress: 'x'.repeat(2001) },
		{ kpp: '123' },
		{ ogrn: '123' },
		{ entityType: 'OTHER' },
		{ legalName: undefined },
		{ secret: true }
	])('rejects invalid v2 requisites', patch =>
		expect(
			parseCompanyV2({ ...company, ...patch }, workspaceId)
		).toBeNull()
	)
})
