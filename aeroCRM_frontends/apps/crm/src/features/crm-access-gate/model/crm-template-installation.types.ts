import type { CrmResolvedAccessResponse } from '@/entities/crm-access'

export interface InstallCrmTemplateCommand {
	commandId: string
	workspaceId: string
	templateKey: string
	templateVersion: number
}

export interface CrmTemplateInstallation {
	commandId: string
	workspaceId: string
	pipelineId: string
	templateKey: string
	templateVersion: number
	templateFingerprint: string
}

export type CrmActiveAccessResponse = CrmResolvedAccessResponse & {
	state: 'ACTIVE' | 'GRACE'
	entitlementStatus: 'ACTIVE' | 'GRACE'
	access: { lifecycle: 'ACTIVE' }
}

export interface CrmTemplateInstallationResponse {
	schemaVersion: 1
	installation: CrmTemplateInstallation
	access: CrmActiveAccessResponse
}
