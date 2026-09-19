import { axiosInterceptorsRequest } from '@/shared/api'

export type ManualAdminTaskId =
	| 'paymentCleanup'
	| 'subscriptionExpiryCheck'
	| 'verificationChallengeCleanup'

export interface ManualAdminTaskRunResult {
	taskId: ManualAdminTaskId
	title: string
	affectedCount: number
	message: string
	executedAt: string
}

const TASK_ENDPOINTS: Record<ManualAdminTaskId, string> = {
	paymentCleanup: '/payments/admin/run-cleanup',
	subscriptionExpiryCheck: '/subscriptions/admin/run-expiry-check',
	verificationChallengeCleanup:
		'/auth/admin/run-verification-challenge-cleanup'
}

const adminTasksService = {
	async runTask(
		taskId: ManualAdminTaskId
	): Promise<ManualAdminTaskRunResult> {
		const { data } = await axiosInterceptorsRequest.post(
			TASK_ENDPOINTS[taskId]
		)
		return data
	}
}

export default adminTasksService
