import { axiosInterceptorsRequest } from '@/shared/api'

export const DATABASE_RESTORE_TARGETS = [
	'notification-delivery',
	'campaigns',
	'reporting',
	'widgets',
	'identity',
	'platform',
	'support'
] as const

export type DatabaseRestoreTarget =
	(typeof DATABASE_RESTORE_TARGETS)[number]

export type DatabaseRestoreJobStatus =
	| 'QUEUED'
	| 'PROCESSING'
	| 'CANCELLED'
	| 'SUCCEEDED'
	| 'FAILED'
	| 'RECOVERY_REQUIRED'

export type DatabaseRestorePermitStatus =
	| 'PENDING_APPROVAL'
	| 'APPROVED'
	| 'CONSUMED'
	| 'CLOSED'

export const DATABASE_RESTORE_RECOVERY_ACTIONS = [
	'VERIFY_AS_IS',
	'ROLL_BACK_SAFETY',
	'ROLL_FORWARD_SOURCE'
] as const

export type DatabaseRestoreRecoveryActionType =
	(typeof DATABASE_RESTORE_RECOVERY_ACTIONS)[number]

export type DatabaseRestoreRecoveryActionStatus =
	| 'PENDING_APPROVAL'
	| 'APPROVED'
	| 'PROCESSING'
	| 'RESOLVED'
	| 'BLOCKED'
	| 'EXPIRED'

export type DatabaseRestoreRecoveryActionPhase =
	| 'PREPARING'
	| 'FENCING'
	| 'FENCED'
	| 'MUTATING'
	| 'VERIFYING'
	| 'VERIFIED'
	| 'UNFENCING'
	| 'RESOLVED'

export interface DatabaseRestoreTargetSettings {
	id: DatabaseRestoreTarget
	label: string
	confirmation: string
	migrationManifestSha: string
}

export interface DatabaseRestorePermit {
	permitId: string
	target: DatabaseRestoreTarget
	jobId: string
	sourceSha256: string
	sourceSize: number
	sourceBackupJobId: string
	backupProvenanceEnvelopeSha256: string
	backupProvenanceKeyId: string
	expectedServicesSha: string
	migrationManifestSha: string
	status: DatabaseRestorePermitStatus
	requestedById: string
	approvedById: string | null
	expiresAt: string
	consumedAt: string | null
	closedAt: string | null
}

export interface DatabaseRestoresSettings {
	enabled: boolean
	currentServicesSha: string
	approved: DatabaseRestorePermit | null
	permitRequired: true
	maxFileSizeBytes: number
	allowedFileExtension: string
	targets: DatabaseRestoreTargetSettings[]
}

export interface CreateDatabaseRestorePermitInput {
	target: DatabaseRestoreTarget
	sourceSha256: string
	expectedServicesSha: string
	backupProvenance: string
}

export interface DatabaseRestoreJobError {
	code: string
	message: string
}

export interface DatabaseRestoreTerminalReceipt {
	terminalStatus: DatabaseRestoreJobStatus
	phase: string | null
	sourceSha256: string
	sourceSize: number
	sourceBackupJobId: string
	backupProvenanceEnvelopeSha256: string
	backupProvenanceKeyId: string
	safetyBackupSha256: string | null
	expectedServicesSha: string
	migrationManifestSha: string
	resultSha256: string | null
	errorSha256: string | null
	payloadSha256: string
	signatureHmacSha256: string
	signatureKeyId: string
	writerFenceRoles: unknown | null
	writerFenceRequestedAt: string | null
	writerFenceAppliedAt: string | null
	writerFenceReleasedAt: string | null
	writerFenceEvidenceSha256: string | null
	writerFenceReleaseEvidenceSha256: string | null
	completedAt: string
}

export interface DatabaseRestoreRecoveryAction {
	actionId: string
	jobId: string
	action: DatabaseRestoreRecoveryActionType
	status: DatabaseRestoreRecoveryActionStatus
	receiptPayloadSha: string
	requestedById: string
	approvedById: string | null
	expiresAt: string
	phase: DatabaseRestoreRecoveryActionPhase | null
	attempts: number
	artifactSha256: string | null
	error: string | null
	result: unknown | null
	startedAt: string | null
	finishedAt: string | null
	writerFenceAppliedAt: string | null
	writerFenceReleasedAt: string | null
	executionAllowed: boolean
	executorStatus: DatabaseRestoreRecoveryActionStatus
}

export interface DatabaseRestoreRecoveryResolutionReceipt {
	actionId: string
	action: DatabaseRestoreRecoveryActionType
	initialReceiptPayloadSha: string
	artifactSha256: string | null
	expectedServicesSha: string
	migrationManifestSha: string
	writerFenceRoles: unknown
	writerFenceAppliedAt: string
	writerFenceReleasedAt: string
	writerFenceEvidenceSha256: string
	writerFenceReleaseEvidenceSha256: string
	resultSha256: string
	payloadSha256: string
	signatureHmacSha256: string
	signatureKeyId: string
	resolvedAt: string
}

export interface DatabaseRestoreJob {
	jobId: string
	target: DatabaseRestoreTarget
	status: DatabaseRestoreJobStatus
	originalFileName: string
	fileSize: number
	sha256: string
	sourceBackupJobId: string
	backupProvenanceEnvelopeSha256: string
	backupProvenanceKeyId: string
	requestedAt: string
	startedAt: string | null
	finishedAt: string | null
	attempt: number
	error: DatabaseRestoreJobError | null
	result: unknown | null
	expectedServicesSha: string
	migrationManifestSha: string
	terminalReceipt: DatabaseRestoreTerminalReceipt | null
	recoveryActions: DatabaseRestoreRecoveryAction[]
	recoveryResolvedAt: string | null
	artifactRetainUntil: string | null
	recoveryResolutionReceipt: DatabaseRestoreRecoveryResolutionReceipt | null
	canCancel: boolean
	cancellationPending: boolean
	cancellationRequested: boolean
	publicationConfirmed: boolean
}

const isDatabaseRestoreTarget = (
	value: unknown
): value is DatabaseRestoreTarget =>
	typeof value === 'string' &&
	DATABASE_RESTORE_TARGETS.includes(value as DatabaseRestoreTarget)

const devToolsService = {
	async getDatabaseRestoresSettings(): Promise<DatabaseRestoresSettings> {
		const { data } =
			await axiosInterceptorsRequest.get<DatabaseRestoresSettings>(
				'/dev-tools/database-restores/settings'
			)

		return {
			...data,
			approved:
				data.approved && isDatabaseRestoreTarget(data.approved.target)
					? data.approved
					: null,
			targets: data.targets.filter(target =>
				isDatabaseRestoreTarget(target.id)
			)
		}
	},

	async startDatabaseRestore(
		target: DatabaseRestoreTarget,
		file: File,
		confirmation: string,
		requestId: string
	): Promise<DatabaseRestoreJob> {
		const formData = new FormData()
		formData.append('file', file)
		formData.append('confirmation', confirmation)
		formData.append('requestId', requestId)

		const { data } =
			await axiosInterceptorsRequest.post<DatabaseRestoreJob>(
				`/dev-tools/database-restores/${encodeURIComponent(target)}`,
				formData,
				{
					headers: { 'Content-Type': 'multipart/form-data' }
				}
			)

		return data
	},

	async createDatabaseRestorePermit(
		input: CreateDatabaseRestorePermitInput
	): Promise<DatabaseRestorePermit> {
		const { data } =
			await axiosInterceptorsRequest.post<DatabaseRestorePermit>(
				'/dev-tools/database-restores/permits',
				input
			)

		return data
	},

	async approveDatabaseRestorePermit(
		permitId: string
	): Promise<DatabaseRestorePermit> {
		const { data } =
			await axiosInterceptorsRequest.post<DatabaseRestorePermit>(
				`/dev-tools/database-restores/permits/${encodeURIComponent(permitId)}/approve`
			)

		return data
	},

	async createDatabaseRestoreRecoveryAction(
		jobId: string,
		action: DatabaseRestoreRecoveryActionType
	): Promise<DatabaseRestoreRecoveryAction> {
		const { data } =
			await axiosInterceptorsRequest.post<DatabaseRestoreRecoveryAction>(
				`/dev-tools/database-restores/jobs/${encodeURIComponent(jobId)}/recovery-actions`,
				{ action }
			)

		return data
	},

	async approveDatabaseRestoreRecoveryAction(
		jobId: string,
		actionId: string
	): Promise<DatabaseRestoreRecoveryAction> {
		const { data } =
			await axiosInterceptorsRequest.post<DatabaseRestoreRecoveryAction>(
				`/dev-tools/database-restores/jobs/${encodeURIComponent(jobId)}/recovery-actions/${encodeURIComponent(actionId)}/approve`
			)

		return data
	},

	async getDatabaseRestoreJob(
		jobId: string,
		signal?: AbortSignal
	): Promise<DatabaseRestoreJob> {
		const { data } =
			await axiosInterceptorsRequest.get<DatabaseRestoreJob>(
				`/dev-tools/database-restores/jobs/${encodeURIComponent(jobId)}`,
				{ signal }
			)

		return data
	},

	async cancelDatabaseRestoreJob(
		jobId: string
	): Promise<DatabaseRestoreJob> {
		const { data } =
			await axiosInterceptorsRequest.post<DatabaseRestoreJob>(
				`/dev-tools/database-restores/jobs/${encodeURIComponent(jobId)}/cancel`
			)

		return data
	}
}

export default devToolsService
