'use client'
import { useAuthStore } from '@/entities/user'
import { axiosInterceptorsRequest } from '@/shared/api'
import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

export interface CrmBillingWorkspace {
	workspaceId: string
	eligibleForAdditionalSeats: boolean
}

type Bootstrap = {
	schemaVersion: number
	workspaces: { workspaceId: string; role: string }[]
}

type BillingContext = {
	schemaVersion: number
	workspaceId: string
	actorSubject: string
	billing: { period: { state: string } | null }
	capabilities: { changeSeats: boolean }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

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
			const { data } = await axiosInterceptorsRequest.get<BillingContext>(
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
				typeof data.capabilities.changeSeats !== 'boolean' ||
				!(data.billing.period === null || isRecord(data.billing.period))
			)
				throw new Error('Invalid CRM billing response')
			const period = data.billing.period
			return {
				workspaceId,
				eligibleForAdditionalSeats:
					isRecord(period) &&
					period.state === 'ACTIVE' &&
					data.capabilities.changeSeats === true
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
