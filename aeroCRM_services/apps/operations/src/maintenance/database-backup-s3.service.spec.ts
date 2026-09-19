import { ConfigService } from '@nestjs/config';
import {
	DeleteObjectCommand,
	ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { DatabaseBackupS3Service } from './database-backup-s3.service';

const target = 'crm-sales' as const;
const prefix = `database-backups/${target}/`;
const old = new Date(Date.now() - 9 * 24 * 60 * 60_000);
const current = new Date();

it('retains the latest complete backup and removes only older objects after a new successful backup', async () => {
	const deleted: string[] = [];
	const client = {
		send: jest.fn(async command => {
			if (command instanceof ListObjectsV2Command) {
				return {
					Contents: [
						{ Key: `${prefix}old/manifest.json`, LastModified: old },
						{ Key: `${prefix}old/dump.dump`, LastModified: old },
						{ Key: `${prefix}new/manifest.json`, LastModified: current },
						{ Key: `${prefix}new/dump.dump`, LastModified: current },
						{ Key: `${prefix}incomplete/dump.dump`, LastModified: old }
					]
				};
			}
			if (command instanceof DeleteObjectCommand) {
				deleted.push(command.input.Key!);
				return {};
			}
			throw new Error('Unexpected S3 command');
		})
	};
	const config = { get: (key: string) => key === 'CRM_BACKUP_RETENTION_DAYS' ? '7' : undefined } as ConfigService;
	const service = new DatabaseBackupS3Service(config);
	Object.assign(service, { client, bucket: 'private-test-bucket' });
	await service.pruneAfterSuccess(target, 'new');
	expect(deleted.sort()).toEqual([
		`${prefix}incomplete/dump.dump`,
		`${prefix}old/dump.dump`,
		`${prefix}old/manifest.json`
	].sort());
});
