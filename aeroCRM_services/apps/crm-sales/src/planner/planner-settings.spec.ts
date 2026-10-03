import { retryablePlannerTransaction } from './planner-settings';

describe('retryablePlannerTransaction', () => {
	it.each([
		['P2034', { code: 'P2034' }],
		['P2010 serialization failure', { code: 'P2010', meta: { code: '40001' } }],
		['P2010 deadlock', { code: 'P2010', meta: { code: '40P01' } }],
	])('retries %s', (_label, error) => {
		expect(retryablePlannerTransaction(error)).toBe(true);
	});

	it.each([
		['a different Prisma code', { code: 'P2002' }],
		['a different raw SQLSTATE', { code: 'P2010', meta: { code: '23505' } }],
		['P2010 without metadata', { code: 'P2010' }],
		['malformed P2010 metadata', { code: 'P2010', meta: '40001' }],
		['a primitive error', 'P2034'],
		['an object without a code', { message: 'serialization failure' }],
	])('does not retry %s', (_label, error) => {
		expect(retryablePlannerTransaction(error)).toBe(false);
	});
});
