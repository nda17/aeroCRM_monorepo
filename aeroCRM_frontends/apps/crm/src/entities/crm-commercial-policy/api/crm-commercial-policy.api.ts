import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { parseCrmCommercialPolicy } from '../model/crm-commercial-policy.contract'

export const getCrmCommercialPolicy = async (accessToken: string) => {
	const policy = parseCrmCommercialPolicy(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/billing-settings/crm'
		})
	)
	if (!policy) throw invalidContractError()
	return policy
}
