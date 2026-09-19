import { parseCampaignsCorsAllowedOrigins } from './campaigns-cors.config';

describe('campaigns CORS configuration', () => {
	it('normalizes, trims and deduplicates exact origins', () => {
		expect(
			parseCampaignsCorsAllowedOrigins(
				' https://aerocrm.space/,http://localhost:3000,https://aerocrm.space '
			)
		).toEqual(['https://aerocrm.space', 'http://localhost:3000']);
	});

	it.each([
		undefined,
		'',
		'*',
		'https://aerocrm.space/path',
		'https://user:password@aerocrm.space',
		'https://aerocrm.space?query=value',
		'https://aerocrm.space#fragment',
		'ftp://aerocrm.space',
		'https://aerocrm.space,'
	])('rejects an unsafe origin list: %s', value => {
		expect(() => parseCampaignsCorsAllowedOrigins(value)).toThrow(
			'CORS_ALLOWED_ORIGINS must contain exact http/https origins'
		);
	});
});
