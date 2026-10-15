'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkdaySession } from '@/entities/crm-workday'
import { isUuidV4 } from '@/shared/lib/contract'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import {
	getLossReasons,
	type LossReasons
} from '../api/sales-productivity.api'

export const useLossReasons = () => {
	const context = useWorkdaySession()
	const client = useQueryClient()
	const actorMembershipId =
		context.permissions.data?.role === 'OWNER'
			? null
			: context.workspace.membership.membershipId
	const actorReady =
		context.permissions.data?.role === 'OWNER' ||
		isUuidV4(actorMembershipId)
	const queryKey = ['sales', 'loss-reasons', ...context.key] as const
	const query = useQuery({
		queryKey,
		enabled: context.canRead,
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: true,
		queryFn: async () => {
			if (!context.current() || !context.session)
				throw invalidContractError()
			const result = await getLossReasons(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			if (!context.current()) throw invalidContractError()
			const cached = client.getQueryData<LossReasons>(queryKey)
			return cached && cached.version > result.version ? cached : result
		}
	})
	return {
		context,
		query,
		queryKey,
		actorMembershipId,
		actorReady,
		canManage:
			actorReady &&
			context.canWrite &&
			['OWNER', 'CRM_ADMIN'].includes(context.permissions.data?.role ?? '')
	}
}
