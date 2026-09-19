import { axiosInterceptorsRequest } from '@/shared/api'

export type CrmProviderOperationStatus =
	| 'PENDING'
	| 'PROCESSING'
	| 'UNKNOWN'
	| 'FAILED'
	| 'DELIVERED'

export interface CrmProviderOperation {
	id: string
	workspaceId: string
	orderId: string
	kind: string
	status: CrmProviderOperationStatus
	version: number
	firstDispatchAt: string | null
	dispatchAttempt: number
	retryAttempt: number
	lastErrorCode: string | null
	createdAt: string
	updatedAt: string
	order: { status: string; amountMinor: string; currency: string }
}

export interface CrmProviderOperationPage {
	schemaVersion: 1
	page: number
	limit: number
	total: number
	items: CrmProviderOperation[]
}

const BASE = '/payments/admin/crm-provider-operations'

export const crmProviderOperationsService = {
	async list(page: number, status?: CrmProviderOperationStatus) {
		const { data } = await axiosInterceptorsRequest.get<CrmProviderOperationPage>(
			BASE,
			{ params: { page, limit: 20, status }, timeout: 15_000 }
		)
		if (data.schemaVersion !== 1 || !Array.isArray(data.items))
			throw new Error('Invalid CRM provider operations response')
		return data
	},
	async retry(operation: CrmProviderOperation) {
		const commandId = window.crypto.randomUUID()
		await axiosInterceptorsRequest.post(
			`${BASE}/${encodeURIComponent(operation.id)}/retry`,
			{
				schemaVersion: 1,
				commandId,
				expectedVersion: operation.version
			},
			{ headers: { 'Idempotency-Key': commandId }, timeout: 30_000 }
		)
	}
}
