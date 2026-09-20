import { ConfigService } from '@nestjs/config';
import { DATABASE_RESTORE_TARGETS } from './database-restore.contract';
import { DatabaseRestoreTargetRegistryService } from './database-restore-target-registry.service';

describe('DatabaseRestoreTargetRegistryService', () => {
	it('registers no restore targets for the current database topology', () => {
		const registry = new DatabaseRestoreTargetRegistryService(
			new ConfigService({})
		);

		expect(registry.all()).toEqual([]);
		for (const target of DATABASE_RESTORE_TARGETS) {
			expect(() => registry.get(target)).toThrow('is not registered');
		}
	});

	it('rejects a stale target before reading its connection settings', async () => {
		const get = jest.fn();
		const registry = new DatabaseRestoreTargetRegistryService({
			get
		} as unknown as ConfigService);

		await expect(
			registry.connection({
				environmentPrefix: 'REPORTING',
				database: 'obsolete_reporting'
			} as never)
		).rejects.toThrow('is not registered');
		expect(get).not.toHaveBeenCalled();
	});
});
