import type { DatabaseBackupTarget } from '../scheduled-jobs/scheduled-jobs.types';

export const DATABASE_BACKUP_MAX_FILE_SIZE_BYTES = Number.MAX_SAFE_INTEGER;

// Signing proves artifact origin. It never grants destructive restore access.
export const DATABASE_BACKUP_PROVENANCE_TARGETS = [
	'notification-delivery',
	'campaigns',
	'reporting',
	'billing',
	'identity',
	'platform',
	'support',
	'operations',
	'crm-access',
	'crm-intake',
	'crm-customers',
	'crm-sales'
] as const satisfies ReadonlyArray<DatabaseBackupTarget>;

export type DatabaseBackupProvenanceTarget =
	(typeof DATABASE_BACKUP_PROVENANCE_TARGETS)[number];

export const isDatabaseBackupProvenanceTarget = (
	value: unknown
): value is DatabaseBackupProvenanceTarget =>
	typeof value === 'string' &&
	DATABASE_BACKUP_PROVENANCE_TARGETS.includes(
		value as DatabaseBackupProvenanceTarget
	);
