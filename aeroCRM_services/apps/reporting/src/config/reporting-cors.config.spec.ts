import {
	isReportingCorsOriginAllowed,
	parseReportingCorsAllowedOrigins
} from './reporting-cors.config';

describe('reporting CORS configuration', () => {
	it('normalizes and deduplicates exact origins', () => {
		const allowed = parseReportingCorsAllowedOrigins(
			' https://aerocrm.space/,http://localhost:3000,https://aerocrm.space '
		);
		expect(allowed).toEqual([
			'https://aerocrm.space',
			'http://localhost:3000'
		]);
		expect(
			isReportingCorsOriginAllowed('https://aerocrm.space', allowed)
		).toBe(true);
		expect(
			isReportingCorsOriginAllowed('https://evil.example', allowed)
		).toBe(false);
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
		expect(() => parseReportingCorsAllowedOrigins(value)).toThrow(
			'CORS_ALLOWED_ORIGINS must contain exact http/https origins'
		);
	});
});
