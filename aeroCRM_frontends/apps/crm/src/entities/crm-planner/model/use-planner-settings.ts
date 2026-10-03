'use client'

import { useQuery } from '@tanstack/react-query'
import { useWorkdaySession } from '@/entities/crm-workday'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { getPlannerSettings } from '../api/planner.api'

export const usePlannerSettings = () => {
	const context = useWorkdaySession()
	const query = useQuery({
		queryKey: ['crm-planner', ...context.key],
		enabled: context.canRead,
		retry: false,
		gcTime: 0,
		staleTime: 0,
		refetchOnWindowFocus: true,
		queryFn: async () => {
			if (!context.current() || !context.session)
				throw invalidContractError()
			const result = await getPlannerSettings(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			if (!context.current()) throw invalidContractError()
			return result
		}
	})
	return {
		context,
		query,
		canManage:
			context.canWrite &&
			['OWNER', 'CRM_ADMIN'].includes(
				context.permissions.data?.role ?? ''
			),
		data: context.canRead && !query.isError ? query.data : undefined
	}
}
