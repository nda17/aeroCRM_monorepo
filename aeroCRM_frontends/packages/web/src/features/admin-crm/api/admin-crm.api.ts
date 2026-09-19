import { axiosInterceptorsRequest } from '@/shared/api'
import {
	parseCrmPipelineTemplateCatalog,
	type CrmPipelineTemplateCatalog
} from '../model/crm-template-catalog.contract'
import {
	parseCrmPricingCommandResult,
	parseCrmPricingSettings,
	type CrmPricingCommand,
	type CrmPricingSettings
} from '../model/crm-pricing.contract'

class AdminCrmService {
	async getPricingSettings(): Promise<CrmPricingSettings> {
		const { data } = await axiosInterceptorsRequest.get<unknown>(
			'/billing-settings/admin/crm',
			{ timeout: 15_000 }
		)
		return parseCrmPricingSettings(data)
	}

	async updatePricingSettings(
		command: CrmPricingCommand
	): Promise<CrmPricingSettings> {
		const { data } = await axiosInterceptorsRequest.put<unknown>(
			'/billing-settings/admin/crm',
			command,
			{
				headers: { 'Idempotency-Key': command.commandId },
				timeout: 15_000
			}
		)
		return parseCrmPricingCommandResult(data, command)
	}

	async getTemplateCatalog(): Promise<CrmPipelineTemplateCatalog> {
		const { data } =
			await axiosInterceptorsRequest.get<unknown>('/crm/templates')

		return parseCrmPipelineTemplateCatalog(data)
	}
}

const adminCrmService = new AdminCrmService()

export default adminCrmService
