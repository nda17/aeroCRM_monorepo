import {
	parseCrmAccessBootstrap,
	parseCrmTrialActivation,
	type CrmAccessBootstrapResponse,
	type CrmTrialActivationResponse
} from '@/entities/crm-access'
import {
	parsePipelineTemplateCatalog,
	type PipelineTemplateCatalog
} from '@/entities/pipeline-template'
import {
	AuthenticatedApiError,
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { hasExactKeys, isRecord, isUuidV4 } from '@/shared/lib/contract'
import axios from 'axios'

import { parseCrmTemplateInstallationResponse } from '../model/crm-template-installation.parser'
import type {
	CrmTemplateInstallationResponse,
	InstallCrmTemplateCommand
} from '../model/crm-template-installation.types'

export class CrmWorkspaceRequiredError extends AuthenticatedApiError {
	constructor() {
		super('forbidden', 'Создайте рабочее пространство для работы с CRM.')
		this.name = 'CrmWorkspaceRequiredError'
	}
}

export const createPersonalCrmWorkspace = async (accessToken: string) => {
	const response = await authenticatedRequest({
		accessToken,
		method: 'POST',
		url: '/users/profile/workspace'
	})
	if (
		!isRecord(response) ||
		!hasExactKeys(response, ['schemaVersion', 'workspaceId']) ||
		response.schemaVersion !== 1 ||
		!isUuidV4(response.workspaceId)
	)
		throw invalidContractError()
	return { workspaceId: response.workspaceId }
}

const mapTemplateInstallationError = (error: unknown) => {
	if (
		axios.isAxiosError(error) &&
		error.response?.status === 404 &&
		isRecord(error.response.data) &&
		error.response.data.code === 'crm_template_version_not_found'
	) {
		return new AuthenticatedApiError(
			'notFound',
			'Запрошенная версия шаблона не найдена.'
		)
	}
	// A route/deployment 404 is not proof that the versioned command was rejected.
	if (axios.isAxiosError(error) && error.response?.status === 404) {
		return new AuthenticatedApiError(
			'temporary',
			'Сервис установки шаблонов временно недоступен.'
		)
	}
	return undefined
}

export const getCrmAccessBootstrap = async (
	accessToken: string,
	workspaceId?: string
): Promise<CrmAccessBootstrapResponse> => {
	const response = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: '/crm/access/bootstrap',
		params: workspaceId ? { workspaceId } : undefined,
		mapError: error =>
			axios.isAxiosError(error) &&
			error.response?.status === 403 &&
			isRecord(error.response.data) &&
			error.response.data.code === 'crm_workspace_required'
				? new CrmWorkspaceRequiredError()
				: undefined
	})
	const parsed = parseCrmAccessBootstrap(response, workspaceId)
	if (!parsed) throw invalidContractError()
	return parsed
}

export const activateCrmTrial = async (
	accessToken: string,
	command: { workspaceId: string; commandId: string }
): Promise<CrmTrialActivationResponse> => {
	const response = await authenticatedRequest({
		accessToken,
		method: 'POST',
		url: '/crm/access/trial',
		headers: { 'Idempotency-Key': command.commandId },
		data: { schemaVersion: 1, ...command }
	})
	const parsed = parseCrmTrialActivation(response, command.workspaceId)
	if (!parsed) throw invalidContractError()
	return parsed
}

export const getPipelineTemplates = async (
	accessToken: string
): Promise<PipelineTemplateCatalog> => {
	const response = await authenticatedRequest({
		accessToken,
		method: 'GET',
		url: '/crm/templates'
	})
	const parsed = parsePipelineTemplateCatalog(response)
	if (!parsed) throw invalidContractError()
	return parsed
}

export const installCrmTemplate = async (
	accessToken: string,
	command: InstallCrmTemplateCommand
): Promise<CrmTemplateInstallationResponse> => {
	const response = await authenticatedRequest({
		accessToken,
		method: 'POST',
		url: '/crm/access/onboarding/template',
		headers: { 'Idempotency-Key': command.commandId },
		data: { schemaVersion: 1, ...command },
		mapError: mapTemplateInstallationError
	})
	const parsed = parseCrmTemplateInstallationResponse(response, command)
	if (!parsed) throw invalidContractError()
	return parsed
}
