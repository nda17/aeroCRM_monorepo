'use client'

import { useQuery } from '@tanstack/react-query'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { getAssigneeLabels } from '../api/assignee-labels.api'
import {
	assigneeBindingKey,
	validAssigneeLabelsRequest
} from './assignee-labels.contract'
import {
	assigneeRoles,
	type AssigneeBinding,
	type AssigneeOption
} from './assignee-options.contract'
import type { AssigneeDirectoryContext } from './use-assignee-options'

export const useAssigneeLabels = (
	context: AssigneeDirectoryContext,
	bindings: readonly AssigneeBinding[]
) => {
	const authority = context.authority
	const unique = [
		...new Map(
			bindings.map(binding => [
				assigneeBindingKey(binding),
				{ ...binding }
			])
		).values()
	].sort((a, b) =>
		assigneeBindingKey(a).localeCompare(assigneeBindingKey(b))
	)
	const request = {
		workspaceId: context.workspaceId,
		subject: context.subject ?? '',
		dataScope: authority?.dataScope ?? 'OWN',
		bindings: unique
	}
	const enabled =
		context.canRead &&
		!!context.accessToken &&
		validAssigneeLabelsRequest(request) &&
		!!authority &&
		authority.workspaceId === context.workspaceId &&
		authority.subject === context.subject &&
		authority.permissions.includes('sales:read') &&
		assigneeRoles.includes(authority.role as AssigneeOption['role']) &&
		['ACTIVE', 'GRACE', 'READ_ONLY'].includes(authority.state)
	const query = useQuery({
		queryKey: [
			'crm-assignee-labels',
			context.workspaceId,
			context.subject,
			context.sessionRevision,
			authority?.role,
			authority?.state,
			authority?.dataScope,
			[...(authority?.teamIds ?? [])].sort(),
			[...(authority?.permissions ?? [])].sort(),
			unique
		],
		enabled,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: 'always',
		queryFn: async ({ signal }) => {
			if (!enabled || !context.isCurrent() || signal.aborted)
				throw invalidContractError()
			const result = await getAssigneeLabels(
				context.accessToken!,
				request,
				signal
			)
			if (!context.isCurrent() || signal.aborted)
				throw invalidContractError()
			return result
		}
	})
	const data =
		enabled && context.isCurrent() && !query.isFetching && query.isSuccess
			? query.data
			: undefined
	return {
		loading:
			unique.length > 0 &&
			(!enabled || query.isPending || query.isFetching),
		error: enabled && query.isError,
		lookup: (binding: AssigneeBinding) =>
			context.isCurrent()
				? data?.items.find(
						row =>
							assigneeBindingKey(row.binding) ===
							assigneeBindingKey(binding)
					)
				: undefined,
		refetch: () => {
			if (enabled && context.isCurrent()) return query.refetch()
		}
	}
}
