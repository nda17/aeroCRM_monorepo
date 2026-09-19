import { parseCrmCustomersCorsAllowedOrigins } from './crm-customers-cors.config';

describe('parseCrmCustomersCorsAllowedOrigins', () => {
	it('normalizes and deduplicates exact origins', () => {
		expect(
			parseCrmCustomersCorsAllowedOrigins(
				'https://crm.aerocrm.space, http://localhost:3001,https://crm.aerocrm.space'
			)
		).toEqual(['https://crm.aerocrm.space', 'http://localhost:3001']);
	});

	it.each([
		undefined,
		'',
		'*',
		'https://crm.aerocrm.space/path',
		'https://user:pass@crm.aerocrm.space',
		'ftp://crm.aerocrm.space'
	])('rejects a non-exact origin: %s', value => {
		expect(() => parseCrmCustomersCorsAllowedOrigins(value)).toThrow(
			'exact http/https origins'
		);
	});
});
