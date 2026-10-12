import { axiosInterceptorsRequest } from '@/shared/api'
import type { IAdminUserOverviewActivity } from '@/entities/user'

export type AdminOverviewPaymentStatus =
	| 'PENDING'
	| 'SUCCEEDED'
	| 'CANCELLED'
	| 'EXPIRED'
	| 'UNKNOWN'
export interface AdminUserOverview {
	subscription: {
		workspaceId: string
		planCode: string
		status: string
		seatLimit: number
		effectiveUntil: string | null
	} | null
	payments: {
		counts: Record<AdminOverviewPaymentStatus, number>
		latest: Array<{
			id: string
			providerPaymentId: string | null
			status: AdminOverviewPaymentStatus
			amountMinor: string
			kind: string
			cycle: string | null
			createdAt: string
			updatedAt: string
		}>
	}
	activity: { latest: IAdminUserOverviewActivity[] }
}
export const adminUserOverviewService = {
	async get(userId: string): Promise<AdminUserOverview> {
		const { data } = await axiosInterceptorsRequest.get<AdminUserOverview>(
			`/users/edit/${userId}/overview`
		)
		return data
	}
}
export const formatAdminAmountMinor = (value: string) => {
	if (!/^-?\d+$/.test(value)) return 'Сумма недоступна'
	const negative = value.startsWith('-')
	const digits = (negative ? value.slice(1) : value).padStart(3, '0')
	const major = digits.slice(0, -2).replace(/^0+(?=\d)/, '')
	const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
	return `${negative ? '-' : ''}${grouped},${digits.slice(-2)}\u00a0₽`
}
