import axios from 'axios'
import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	isLookupInn,
	parseCompanyLookup
} from '../model/company-lookup.contract'

export const lookupCompany = async (
	accessToken: string,
	workspaceId: string,
	inn: string
) => {
	if (!isUuidV4(workspaceId) || !isLookupInn(inn))
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте ИНН: нужны 10 или 12 цифр с корректной контрольной суммой.'
		)
	const value = await authenticatedRequest({
		accessToken,
		method: 'POST',
		url: '/crm/customers/company-lookup',
		data: { schemaVersion: 1, workspaceId, inn },
		mapError: error =>
			axios.isAxiosError(error) && error.response?.status === 429
				? new AuthenticatedApiError(
						'temporary',
						'Достигнут лимит поиска реквизитов. Повторите позже или заполните поля вручную.'
					)
				: undefined
	})
	const result = parseCompanyLookup(value, inn)
	if (!result) throw invalidContractError()
	return result
}
