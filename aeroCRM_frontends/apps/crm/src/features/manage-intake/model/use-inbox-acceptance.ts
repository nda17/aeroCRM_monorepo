'use client'

import {
	getInboxAcceptance,
	isAcceptanceTerminal,
	mutateInboxAcceptance
} from '@/entities/intake'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import type { IntakeAccess } from './use-intake-access'
import { useIntakeCommand } from './use-intake-command'

export const useInboxAcceptance = (
	access: IntakeAccess,
	entryId?: string
) => {
	const client = useQueryClient()
	const key = [
		'crm-intake-acceptance',
		access.workspaceId,
		access.session?.userId,
		access.revision,
		access.scopeKey,
		entryId
	]
	const query = useQuery({
		queryKey: key,
		enabled: !!entryId && access.canRead,
		queryFn: () =>
			getInboxAcceptance(
				access.session!.accessToken,
				access.workspaceId,
				entryId!
			),
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: true,
		refetchInterval: state =>
			state.state.data?.acceptance &&
			!isAcceptanceTerminal(state.state.data.acceptance.status) &&
			!state.state.error
				? 5000
				: false
	})
	const observed = useRef('')
	const row =
		access.canRead && !query.isError ? query.data?.acceptance : undefined
	useEffect(() => {
		if (!row || !isAcceptanceTerminal(row.status)) return
		const fingerprint = `${access.workspaceId}:${access.session?.userId}:${access.revision}:${access.scopeKey}:${row.id}:${row.status}`
		if (observed.current === fingerprint) return
		observed.current = fingerprint
		for (const prefix of [
			'crm-intake-entry',
			'crm-intake-history',
			'crm-inbox',
			'crm-customers'
		])
			void client.invalidateQueries({
				queryKey: [prefix, access.workspaceId]
			})
		void client.invalidateQueries({ queryKey: ['sales'] })
	}, [
		row,
		client,
		access.workspaceId,
		access.session?.userId,
		access.revision,
		access.scopeKey
	])
	const command = useIntakeCommand(
		access,
		'intake:write',
		mutateInboxAcceptance,
		result => {
			client.setQueryData(key, result)
			toast.success(
				result.acceptance?.status === 'COMPLETED'
					? 'Обращение принято: контакт, сделка и задача подтверждены'
					: 'Запрос принят. Результат обработки появится здесь.'
			)
			void client.invalidateQueries({
				queryKey: ['crm-intake-history', access.workspaceId]
			})
		},
		`acceptance:${entryId ?? 'none'}`
	)
	return {
		query,
		row,
		command,
		// A failed/missing read is never interpreted as an absent workflow.
		blocksEntry:
			!!entryId &&
			(command.locked ||
				!access.canRead ||
				!query.isSuccess ||
				query.isFetching ||
				(!!row && !isAcceptanceTerminal(row.status)))
	}
}
export type InboxAcceptanceContext = ReturnType<typeof useInboxAcceptance>
