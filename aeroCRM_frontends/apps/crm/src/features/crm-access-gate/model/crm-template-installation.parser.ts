import { parseCrmAccessBootstrap } from '@/entities/crm-access'
import {
	hasExactKeys,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

import type {
	CrmTemplateInstallationResponse,
	InstallCrmTemplateCommand
} from './crm-template-installation.types'

const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SHA_256_PATTERN = /^[a-f0-9]{64}$/
const MAX_TEMPLATE_VERSION = 32767

const isTemplateVersion = (value: unknown): value is number =>
	typeof value === 'number' &&
	Number.isSafeInteger(value) &&
	value > 0 &&
	value <= MAX_TEMPLATE_VERSION

export const parseCrmTemplateInstallationResponse = (
	value: unknown,
	expected: InstallCrmTemplateCommand
): CrmTemplateInstallationResponse | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'installation', 'access']) ||
		value.schemaVersion !== 1 ||
		!isRecord(value.installation) ||
		!hasExactKeys(value.installation, [
			'commandId',
			'workspaceId',
			'pipelineId',
			'templateKey',
			'templateVersion',
			'templateFingerprint'
		])
	) {
		return null
	}

	const installation = value.installation
	if (
		!isUuidV4(installation.commandId) ||
		installation.commandId !== expected.commandId ||
		!isUuidV4(installation.workspaceId) ||
		installation.workspaceId !== expected.workspaceId ||
		!isUuidV4(installation.pipelineId) ||
		!isNonEmptyString(installation.templateKey, 64) ||
		!TEMPLATE_KEY_PATTERN.test(installation.templateKey) ||
		installation.templateKey !== expected.templateKey ||
		!isTemplateVersion(installation.templateVersion) ||
		installation.templateVersion !== expected.templateVersion ||
		typeof installation.templateFingerprint !== 'string' ||
		!SHA_256_PATTERN.test(installation.templateFingerprint)
	) {
		return null
	}

	const access = parseCrmAccessBootstrap(
		value.access,
		expected.workspaceId
	)
	if (
		!access ||
		(access.state !== 'ACTIVE' && access.state !== 'GRACE') ||
		access.entitlementStatus !== access.state ||
		access.access?.lifecycle !== 'ACTIVE'
	) {
		return null
	}
	const activeAccess = {
		...access,
		state: access.state,
		entitlementStatus: access.state,
		access: { lifecycle: 'ACTIVE' as const }
	}

	return {
		schemaVersion: 1,
		installation: {
			commandId: installation.commandId,
			workspaceId: installation.workspaceId,
			pipelineId: installation.pipelineId,
			templateKey: installation.templateKey,
			templateVersion: installation.templateVersion,
			templateFingerprint: installation.templateFingerprint
		},
		access: activeAccess
	}
}
