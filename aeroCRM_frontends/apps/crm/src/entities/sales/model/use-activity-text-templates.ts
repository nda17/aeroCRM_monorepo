'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkdaySession } from '@/entities/crm-workday'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import type { ActivityTextTemplatesSnapshot } from './activity-text-templates.contract'
import { getActivityTextTemplates } from '../api/activity-text-templates.api'

export const useActivityTextTemplates = () => {
	const context = useWorkdaySession()
	const client = useQueryClient()
	const queryKey = ['crm-activity-text-templates', ...context.key] as const
	const query = useQuery({
		queryKey,
		enabled: context.canRead,
		retry: false,
		gcTime: 0,
		staleTime: 0,
		refetchOnWindowFocus: true,
		queryFn: async () => {
			if (!context.current() || !context.session)
				throw invalidContractError()
			const result = await getActivityTextTemplates(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			if (!context.current()) throw invalidContractError()
			const cached =
				client.getQueryData<ActivityTextTemplatesSnapshot>(queryKey)
			return cached && cached.version > result.version ? cached : result
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
