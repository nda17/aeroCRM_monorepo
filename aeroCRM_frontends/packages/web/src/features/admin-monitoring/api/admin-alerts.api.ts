import { axiosInterceptorsRequest } from '@/shared/api'

export type AdminAlertType =
	| 'EXPIRED_ACTIVE_CRM_ENTITLEMENT'
	| 'CRM_ENTITLEMENT_EXPIRES_SOON'
	| 'CRM_PROVIDER_OPERATION_UNKNOWN'
	| 'CRM_SUCCEEDED_ORDER_WITHOUT_ENTITLEMENT'
	| 'CRM_RECEIPT_PENDING'
	| 'INTEGRATION_PROBLEM'

export type AdminAlertSeverity = 'HIGH' | 'MEDIUM' | 'LOW'

export interface IAdminAlertTargetUser {
	id: string
	name: string | null
	email: string | null
}

export interface IAdminAlert {
	type: AdminAlertType
	severity: AdminAlertSeverity
	referenceId: string
	targetUser: IAdminAlertTargetUser | null
	title: string
	message: string
	alertAt: string
}

export interface IAdminAlertsResponse {
	items: IAdminAlert[]
	total: number
	page: number
	limit: number
	totalPages: number
}

export interface IAdminAlertFilters {
	type?: AdminAlertType
	severity?: AdminAlertSeverity
	search?: string
}

const adminAlertsService = {
	async getAll(
		page: number,
		limit: number,
		filters?: IAdminAlertFilters
	): Promise<IAdminAlertsResponse> {
		const { data } = await axiosInterceptorsRequest.get('/admin-alerts', {
			params: { page, limit, ...filters }
		})
		return data
	}
}

export default adminAlertsService
