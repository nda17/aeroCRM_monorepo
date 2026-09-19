'use client'

import {
	crmPermissionScope,
	getCrmPermissions
} from '@/entities/crm-access'
import {
	importInboxCsv,
	type CsvImportCommand,
	type CsvImportSummary
} from '@/entities/intake'
import { useSessionStore } from '@/entities/session'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import { useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef } from 'react'
import type { IntakeAccess } from './use-intake-access'

export const useCsvImportCommand = (
	access: IntakeAccess,
	onSaved: (summary: CsvImportSummary) => void
) => {
	const client = useQueryClient()
	const mounted = useRef(false)
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const isCurrent = () => {
		const current = useSessionStore.getState()
		return (
			current.status === 'authenticated' &&
			current.session?.userId === access.session?.userId &&
			current.session?.accessToken === access.session?.accessToken &&
			current.sessionRevision === access.revision
		)
	}
	return useMemoryCommand<CsvImportCommand, CsvImportSummary>(
		{
			owner: commandOwner(access.session?.userId, access.revision),
			workspaceId: access.workspaceId,
			view: access.scopeKey
		},
		'intake:csv-import',
		access.canWrite &&
			access.online &&
			access.permissions.data?.role !== 'ANALYST',
		async () => {
			if (
				!access.session ||
				!mounted.current ||
				!isCurrent() ||
				!navigator.onLine
			)
				throw new AuthenticatedApiError(
					'temporary',
					'Проверьте вход и подключение к сети.'
				)
			const fresh = await getCrmPermissions(
				access.session.accessToken,
				access.workspaceId
			)
			if (
				!mounted.current ||
				!isCurrent() ||
				fresh.subject !== access.session.userId
			)
				throw invalidContractError()
			const key = [
				'crm-permissions',
				access.workspaceId,
				access.session.userId,
				access.revision
			]
			// Prevent an older in-flight read from restoring broader permissions.
			await client.cancelQueries({ queryKey: key, exact: true })
			if (!mounted.current || !isCurrent()) throw invalidContractError()
			client.setQueryData(key, fresh)
			if (
				crmPermissionScope(fresh) !== access.scopeKey ||
				fresh.state === 'READ_ONLY' ||
				fresh.role === 'ANALYST' ||
				!fresh.permissions.includes('intake:write')
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Права изменились. Проверьте доступ и состав команды перед повтором.'
				)
			return access.session.accessToken
		},
		async (token, command) => {
			// The coordinator authorizes each replay and preserves exact payload on
			// unknown/401 outcomes; this boundary never changes the session owner.
			if (!isCurrent() || token !== access.session?.accessToken)
				throw invalidContractError()
			return importInboxCsv(token, command, access.session!.userId)
		},
		onSaved
	)
}
