'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { getMailTemplates } from '@/entities/mail/api/mail-templates.api'
import type { MailTemplatesSnapshot } from '@/entities/mail/model/mail-templates.contract'
import { useMailContext } from './use-mail-context'

export const useMailTemplates = () => {
	const context = useMailContext()
	const client = useQueryClient()
	const canRead =
		context.capabilities.data?.enabled === true &&
		context.capabilities.data.mailPermissions.includes('mail:read') &&
		!context.capabilities.isFetching &&
		!context.capabilities.isError
	const canManage =
		canRead &&
		context.workspace.canWrite &&
		['OWNER', 'CRM_ADMIN'].includes(context.workspace.membership.role) &&
		context.capabilities.data?.mailPermissions.includes('mail:manage') ===
			true
	const queryKey = ['mail-templates', ...context.key] as const
	const query = useQuery({
		queryKey,
		enabled: !!context.session && canRead,
		retry: false,
		gcTime: 0,
		staleTime: 0,
		refetchOnWindowFocus: true,
		queryFn: async () => {
			if (!context.current() || !context.session)
				throw invalidContractError()
			const result = await getMailTemplates(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			if (!context.current()) throw invalidContractError()
			const cached = client.getQueryData<MailTemplatesSnapshot>(queryKey)
			return cached && cached.version > result.version ? cached : result
		}
	})
	return {
		context,
		query,
		queryKey,
		canRead,
		canManage,
		data: canRead && !query.isError ? query.data : undefined
	}
}
