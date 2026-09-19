'use client'

import { useCrmWorkspaceAccess } from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { useQuery } from '@tanstack/react-query'
import { getWorkspaceBranding } from '../api/branding.api'

export const useWorkspaceBranding = () => {
	const workspace = useCrmWorkspaceAccess()
	const { session, sessionRevision } = useSessionStore()
	const key = [
		workspace.workspaceId,
		session?.userId,
		sessionRevision
	] as const
	const query = useQuery({
		queryKey: ['crm-workspace-branding', ...key],
		enabled: !!session,
		queryFn: () =>
			getWorkspaceBranding(session!.accessToken, {
				workspaceId: workspace.workspaceId,
				subject: session!.userId
			}),
		retry: false,
		staleTime: 30_000,
		gcTime: 0
	})
	const denied =
		query.error instanceof AuthenticatedApiError &&
		['unauthorized', 'forbidden', 'notFound'].includes(query.error.kind)
	// A transient refresh must not unmount an editor and erase its draft. A fresh
	// access denial, another workspace or another auth generation never retains data.
	const data =
		session &&
		!denied &&
		query.data?.subject === session.userId &&
		query.data.workspaceId === workspace.workspaceId
			? query.data
			: undefined
	return { workspace, session, sessionRevision, key, query, data }
}
