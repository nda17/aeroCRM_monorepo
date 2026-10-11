'use client'

import { useQuery } from '@tanstack/react-query'
import { listDirectory } from '@/entities/workspace-collaboration'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { useLayoutEffect, useRef } from 'react'
import { useCrmWorkspaceAccess } from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'

/** The directory includes archived employees so historical actions keep a name. */
export const useEmployeeNames = (access: {
	workspaceId: string
	session: { userId: string; accessToken: string } | null
	revision: number
	scopeKey: string
	canRead: boolean
}) => {
	const workspace = useCrmWorkspaceAccess()
	const key = [
		access.workspaceId,
		access.session?.userId,
		access.revision,
		workspace.membership.membershipId,
		access.scopeKey
	]
	const identity = JSON.stringify(key)
	const ready =
		access.canRead &&
		!!access.session &&
		workspace.workspaceId === access.workspaceId
	const token = access.session?.accessToken ?? null
	const live = useRef({ identity, token, ready, mounted: true })
	useLayoutEffect(() => {
		const previous = live.current
		if (
			previous.identity === identity &&
			previous.token === token &&
			previous.ready === ready
		)
			previous.mounted = true
		else live.current = { identity, token, ready, mounted: true }
		const owner = live.current
		return () => {
			owner.mounted = false
		}
	}, [identity, ready, token])
	const current = (owner: typeof live.current) => {
		const state = useSessionStore.getState()
		return (
			live.current === owner &&
			owner.mounted &&
			owner.ready &&
			owner.identity === identity &&
			owner.token === token &&
			state.sessionRevision === access.revision &&
			state.session?.userId === access.session?.userId &&
			state.session?.accessToken === access.session?.accessToken
		)
	}
	const query = useQuery({
		queryKey: ['workspace-directory', ...key, 'action-authors'],
		enabled: ready,
		queryFn: async () => {
			const owner = live.current
			const names: Record<string, string> = {}
			for (let page = 1; page <= 10; page++) {
				if (!current(owner) || !access.session) throw invalidContractError()
				const result = await listDirectory(access.session.accessToken, {
					workspaceId: access.workspaceId,
					subject: access.session.userId,
					page,
					pageSize: 100,
					includeArchived: true
				})
				if (!current(owner)) throw invalidContractError()
				for (const employee of result.items)
					if (employee.subject)
						names[employee.subject] = employee.displayName
				if (page * 100 >= result.total) break
			}
			return names
		},
		retry: false,
		staleTime: 60000,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	return (subject: string) =>
		(ready && !query.isError ? query.data?.[subject] : undefined) ||
		(subject === access.session?.userId
			? 'Вы'
			: 'Сотрудник — имя недоступно')
}
