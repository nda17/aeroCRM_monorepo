'use client'
import { useAuthStore } from '@/entities/user'
import { axiosInterceptorsRequest } from '@/shared/api'
import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

export interface CrmBillingWorkspace {
	workspaceId: string
	eligibleForAdditionalSeats: boolean
	subscription: {
		status: 'TRIAL' | 'PAID' | 'GRACE' | 'SCHEDULED' | 'INACTIVE'
		expiresAt: string | null
		seats: number | null
	}
}

type Bootstrap = {
	schemaVersion: number
	workspaces: { workspaceId: string; role: string }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

const isIsoDate = (value: unknown): value is string =>
	typeof value === 'string' &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value

const isSeats = (value: unknown): value is number =>
	Number.isSafeInteger(value) &&
	Number(value) >= 2 &&
	Number(value) <= 10000

const periodStates = ['SCHEDULED', 'ACTIVE', 'GRACE', 'EXPIRED'] as const
type PeriodState = (typeof periodStates)[number]
const isPeriodState = (value: unknown): value is PeriodState =>
	periodStates.some(state => state === value)

const readSubscription = (
	billing: Record<string, unknown>
): CrmBillingWorkspace['subscription'] => {
	const { trial, period, serverTime } = billing
	if (
		!isIsoDate(serverTime) ||
		!(
			trial === null ||
			(isRecord(trial) &&
				isIsoDate(trial.expiresAt) &&
				isSeats(trial.seatLimit))
		) ||
		!(
			period === null ||
			(isRecord(period) &&
				isPeriodState(period.state) &&
				isIsoDate(period.expiresAt) &&
				isIsoDate(period.graceUntil) &&
				isSeats(period.totalSeats))
		)
	)
		throw new Error('Invalid CRM billing response')

	if (isRecord(period) && period.state === 'ACTIVE')
		return {
			status: 'PAID',
			expiresAt: period.expiresAt as string,
			seats: period.totalSeats as number
		}
	if (isRecord(period) && period.state === 'GRACE')
		return {
			status: 'GRACE',
			expiresAt: period.graceUntil as string,
			seats: period.totalSeats as number
		}
	if (isRecord(trial) && (trial.expiresAt as string) > serverTime)
		return {
			status: 'TRIAL',
			expiresAt: trial.expiresAt as string,
			seats: trial.seatLimit as number
		}
	if (isRecord(period) && period.state === 'SCHEDULED')
		return {
			status: 'SCHEDULED',
			expiresAt: period.expiresAt as string,
			seats: period.totalSeats as number
		}
	return {
		status: 'INACTIVE',
		expiresAt: isRecord(period)
			? (period.graceUntil as string)
			: isRecord(trial)
				? (trial.expiresAt as string)
				: null,
		seats: null
	}
}

const ownerIds = (value: unknown): string[] => {
	if (
		!isRecord(value) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.workspaces)
	)
		throw new Error('Invalid CRM workspace response')
	return Array.from(
		new Set(
			value.workspaces
				.map((workspace: unknown) => {
					if (
						!isRecord(workspace) ||
						typeof workspace.workspaceId !== 'string' ||
						!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
							workspace.workspaceId
						) ||
						!['OWNER', 'MEMBER'].includes(String(workspace.role))
					)
						throw new Error('Invalid CRM workspace membership')
					return workspace.role === 'OWNER' ? workspace.workspaceId : null
				})
				.filter((id): id is string => id !== null)
		)
	)
}

const readOwnerWorkspaces = async (
	userId: string
): Promise<CrmBillingWorkspace[]> => {
	let bootstrap: Bootstrap
	try {
		const response = await axiosInterceptorsRequest.get<Bootstrap>(
			'/crm/access/bootstrap'
		)
		bootstrap = response.data
	} catch (error) {
		if (
			isAxiosError(error) &&
			error.response?.status === 403 &&
			isRecord(error.response.data) &&
			error.response.data.code === 'crm_workspace_required'
		)
			return []
		throw error
	}
	const ids = ownerIds(bootstrap)
	return Promise.all(
		ids.map(async workspaceId => {
			const { data } = await axiosInterceptorsRequest.get<unknown>(
				'/crm/access/billing',
				{ params: { workspaceId } }
			)
			if (
				!isRecord(data) ||
				data.schemaVersion !== 1 ||
				data.workspaceId !== workspaceId ||
				data.actorSubject !== userId ||
				!isRecord(data.billing) ||
				!isRecord(data.capabilities) ||
				typeof data.capabilities.changeSeats !== 'boolean'
			)
				throw new Error('Invalid CRM billing response')
			const subscription = readSubscription(data.billing)
			return {
				workspaceId,
				eligibleForAdditionalSeats:
					subscription.status === 'PAID' &&
					data.capabilities.changeSeats === true,
				subscription
			}
		})
	)
}

export const useCrmBillingWorkspaces = (
	userId: string | null | undefined
) => {
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)
	const enabled = isAuthResolved && auth && Boolean(userId)
	const query = useQuery({
		queryKey: ['crm-billing-workspaces', userId],
		queryFn: async () => ({
			userId,
			ownerWorkspaces: await readOwnerWorkspaces(userId!)
		}),
		enabled,
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	return {
		ownerWorkspaces:
			enabled && !query.isError && query.data?.userId === userId
				? query.data.ownerWorkspaces
				: [],
		isLoading: enabled && (query.isLoading || query.isFetching),
		isError: enabled && query.isError
	}
}
