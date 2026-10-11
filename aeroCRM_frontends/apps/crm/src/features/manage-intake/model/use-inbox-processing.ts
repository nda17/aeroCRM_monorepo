'use client'

import { useQuery } from '@tanstack/react-query'
import { listInboxProcessing } from '@/entities/intake'
import type { IntakeAccess } from './use-intake-access'

export const useInboxProcessing = (
	access: IntakeAccess,
	entryIds: string[],
	enabled = true
) =>
	useQuery({
		queryKey: [
			'crm-inbox-processing',
			access.workspaceId,
			access.session?.userId,
			access.revision,
			access.scopeKey,
			entryIds
		],
		enabled:
			enabled && access.canRead && !!access.session && entryIds.length > 0,
		queryFn: () =>
			listInboxProcessing(
				access.session!.accessToken,
				access.workspaceId,
				entryIds
			),
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: true,
		refetchInterval: 15000
	})
