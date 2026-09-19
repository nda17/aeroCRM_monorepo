'use client'

import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSessionStore } from '@/entities/session'
import {
	useCrmWorkspaceAccess,
	useCrmPermissions,
	crmPermissionScope
} from '@/entities/crm-access'
import {
	startLiveUpdates,
	type LiveEvent
} from '@/shared/api/live-updates'

const roots = {
	intake: [
		'crm-inbox',
		'crm-inbox-sla',
		'crm-intake-entry',
		'crm-intake-acceptance',
		'crm-intake-history',
		'crm-intake-notifications',
		'crm-intake-sources'
	],
	sales: [
		'sales',
		'crm-workday',
		'crm-task-series',
		'crm-task-notifications'
	],
	customers: [
		'crm-customers',
		'crm-customer-detail',
		'crm-company-picker'
	],
	support: ['support-chat', 'crm-support-notifications']
} as const
type Owner = keyof typeof roots

// Keep a trailing refresh if another event arrives during a slow HTTP read.
export function liveInvalidator(
	client: QueryClient,
	owner: Owner,
	current: () => boolean
) {
	let queued: ReturnType<typeof setTimeout> | undefined
	let running = false
	let dirty = false
	let full = false
	let stopped = false
	const flush = async () => {
		queued = undefined
		if (running || stopped || !current()) return
		running = true
		dirty = false
		const all = full
		full = false
		try {
			await client.invalidateQueries(
				{
					predicate: query =>
						query.isActive() &&
						(all
							? (roots[owner] as readonly unknown[]).includes(
									query.queryKey[0]
								)
							: query.queryKey[0] === 'crm-task-notifications'),
					refetchType: 'active'
				},
				{ cancelRefetch: false }
			)
		} finally {
			running = false
			if (dirty && !stopped && current())
				queued = setTimeout(() => void flush(), 300)
		}
	}
	return {
		event: (event: LiveEvent) => {
			if (stopped || !current()) return
			if (event === 'access') {
				void client.invalidateQueries(
					{ queryKey: ['crm-permissions'] },
					{ cancelRefetch: false }
				)
				void client.invalidateQueries(
					{ queryKey: ['crm-access'] },
					{ cancelRefetch: false }
				)
			}
			if (event === 'clock' && owner !== 'sales') return
			dirty = true
			full ||= event !== 'clock'
			if (!queued && !running) queued = setTimeout(() => void flush(), 300)
		},
		stop: () => {
			stopped = true
			if (queued) clearTimeout(queued)
		}
	}
}

function useLiveOwner(owner: Owner, path: string | null, binding: string) {
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const client = useQueryClient()
	useEffect(() => {
		if (!session || !path) return
		let mounted = true
		const current = () => {
			const state = useSessionStore.getState()
			return (
				mounted &&
				state.status === 'authenticated' &&
				state.session?.userId === session.userId &&
				state.session?.accessToken === session.accessToken &&
				state.sessionRevision === revision
			)
		}
		const invalidator = liveInvalidator(client, owner, current)
		let lastFallback = 0
		const stop = startLiveUpdates({
			accessToken: session.accessToken,
			path,
			isCurrent: current,
			onEvent: invalidator.event,
			onUnavailable: () => {
				// Compatible with a temporarily unavailable/older server during rollout.
				if (Date.now() - lastFallback >= 30000) {
					lastFallback = Date.now()
					invalidator.event('invalidate')
				}
			}
		})
		return () => {
			mounted = false
			stop()
			invalidator.stop()
		}
	}, [client, owner, path, session, revision, binding])
}

export function SupportLiveUpdates() {
	useLiveOwner('support', '/support/events', 'support')
	return null
}

export function WorkspaceLiveUpdates() {
	const workspace = useCrmWorkspaceAccess()
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		revision
	)
	const access =
		permissions.isSuccess && permissions.data.subject === session?.userId
			? permissions.data
			: undefined
	const binding = workspace.workspaceId + ':' + crmPermissionScope(access)
	const path = (owner: string) =>
		'/crm/' +
		owner +
		'/events?workspaceId=' +
		encodeURIComponent(workspace.workspaceId)
	useLiveOwner(
		'intake',
		access?.permissions.includes('intake:read') ? path('intake') : null,
		binding
	)
	useLiveOwner(
		'customers',
		access?.permissions.includes('customers:read')
			? path('customers')
			: null,
		binding
	)
	useLiveOwner(
		'sales',
		access?.permissions.some(
			p => p === 'sales:read' || p === 'sales:analytics'
		)
			? path('sales')
			: null,
		binding
	)
	return null
}
