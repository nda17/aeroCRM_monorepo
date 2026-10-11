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
import { useInboxProcessing } from './use-inbox-processing'

export const useInboxAcceptance = (
	access: IntakeAccess,
	entryId?: string
) => {
	const client = useQueryClient()
	const processing = useInboxProcessing(access, entryId ? [entryId] : [])
	const summary =
		processing.isSuccess && !processing.isError
			? processing.data.items[0]?.acceptance
			: undefined
	const foreign =
		!!summary &&
		summary.actorSubject !== access.session?.userId &&
		!access.sourceManager
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
		enabled:
			!!entryId &&
			access.canRead &&
			processing.isSuccess &&
			!processing.isError &&
			!foreign,
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
		access.canRead && !foreign && !query.isError
			? query.data?.acceptance
			: undefined
	useEffect(() => {
		if (!row || !isAcceptanceTerminal(row.status)) return
		const fingerprint = `${access.workspaceId}:${access.session?.userId}:${access.revision}:${access.scopeKey}:${row.id}:${row.status}`
		if (observed.current === fingerprint) return
		observed.current = fingerprint
		for (const prefix of [
			'crm-intake-entry',
			'crm-intake-history',
			'crm-inbox',
			'crm-inbox-processing',
			'crm-intake-mail-processing',
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
		'intake:accept',
		mutateInboxAcceptance,
		result => {
			client.setQueryData(key, result)
			void client.invalidateQueries({ queryKey: ['crm-inbox-processing'] })
			void client.invalidateQueries({
				queryKey: ['crm-intake-mail-processing']
			})
			void client.invalidateQueries({
				queryKey: ['crm-inbox', access.workspaceId]
			})
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
	useEffect(() => {
		if (command.error?.kind === 'conflict' || query.isError)
			void client.invalidateQueries({
				queryKey: ['crm-inbox-processing', access.workspaceId]
			})
	}, [client, access.workspaceId, command.error, query.isError])
	return {
		query,
		processing,
		summary,
		foreign,
		row,
		command,
		// A failed/missing read is never interpreted as an absent workflow.
		blocksEntry:
			!!entryId &&
			(command.locked ||
				!access.canRead ||
				!processing.isSuccess ||
				processing.isError ||
				processing.isFetching ||
				foreign ||
				!query.isSuccess ||
				query.isFetching ||
				(!!row && !isAcceptanceTerminal(row.status)))
	}
}
export type InboxAcceptanceContext = ReturnType<typeof useInboxAcceptance>
