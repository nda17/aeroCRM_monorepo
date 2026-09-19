import { parseCrmSalesCorsAllowedOrigins } from './crm-sales-cors.config';

describe('parseCrmSalesCorsAllowedOrigins', () => {
	it('normalizes and deduplicates exact origins', () => {
		expect(
			parseCrmSalesCorsAllowedOrigins(
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
		expect(() => parseCrmSalesCorsAllowedOrigins(value)).toThrow(
			'exact http/https origins'
		);
	});
});
