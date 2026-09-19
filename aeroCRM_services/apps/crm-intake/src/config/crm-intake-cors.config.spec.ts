import { parseCrmIntakeCorsAllowedOrigins } from './crm-intake-cors.config';

describe('parseCrmIntakeCorsAllowedOrigins', () => {
	it('normalizes and deduplicates exact origins', () => {
		expect(
			parseCrmIntakeCorsAllowedOrigins(
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
		expect(() => parseCrmIntakeCorsAllowedOrigins(value)).toThrow(
			'exact http/https origins'
		);
	});
});
