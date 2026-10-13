import { databaseMaintenanceSafeError } from './database-maintenance.cli';

const generic = 'Database maintenance failed; inspect the private receipt ledger';
const unknownError = 'Database maintenance failed';

describe('databaseMaintenanceSafeError', () => {
	it.each([
		'ERROR: insert failed\nDETAIL: Failing row contains (business-marker-719)',
		'FATAL: database connection rejected',
		'PANIC: backend failure',
		'CONTEXT: SQL statement contains private data',
		'STATEMENT: UPDATE users SET email = \'private@example.test\'',
		'pg_dump: error: dump failed for business-marker-719',
		'pg_restore: error: restore failed for business-marker-719',
		'postgresql://operator:password-value@127.0.0.1/postgres',
		'password=private-value',
		'secret private-value',
		'token private-value',
		'credential private-value'
	])('redacts sensitive database error: %s', message => {
		const safe = databaseMaintenanceSafeError(new Error(message));

		expect(safe).toBe(generic);
		expect(safe).not.toContain('business-marker-719');
		expect(safe).not.toContain('private-value');
	});

	it('preserves bounded contract validation errors on one line', () => {
		const safe = databaseMaintenanceSafeError(
			new Error(`Invalid maintenance confirmation\r\n${'x'.repeat(500)}`)
		);

		expect(safe).toHaveLength(400);
		expect(safe).toMatch(/^Invalid maintenance confirmation /);
		expect(safe).not.toMatch(/[\r\n]/);
	});

	it('uses a generic message for unknown error values', () => {
		expect(databaseMaintenanceSafeError({ message: 'untrusted detail' })).toBe(unknownError);
		expect(databaseMaintenanceSafeError(null)).toBe(unknownError);
	});
});
