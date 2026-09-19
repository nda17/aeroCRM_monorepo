'use client'

import { getBillingContext } from '@/entities/crm-billing'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useBillingActor } from './use-billing-actor'

export const useBillingContext = (workspaceId: string) => {
	const actor = useBillingActor(workspaceId)
	const client = useQueryClient()
	const queryKey = ['crm-billing-context', ...actor.key] as const
	const [denied, setDenied] = useState(false)
	const read = async () => {
		if (!actor.session || !actor.current() || !navigator.onLine)
			throw new AuthenticatedApiError(
				'temporary',
				'Проверьте вход и подключение к сети.'
			)
		try {
			const result = await getBillingContext(
				actor.session.accessToken,
				workspaceId,
				actor.session.userId
			)
			if (!actor.current()) throw invalidContractError()
			setDenied(false)
			return result
		} catch (error) {
			if (actor.current()) setDenied(true)
			throw error
		}
	}
	const query = useQuery({
		queryKey,
		queryFn: read,
		enabled: actor.enabled,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: 'always'
	})
	const authorize = async () => {
		// Cancel stale context reads before publishing fresh, potentially narrower
		// authority. This is independent of the CRM write/onboarding gate.
		await client.cancelQueries({ queryKey, exact: true })
		if (!actor.current()) throw invalidContractError()
		const result = await read()
		if (!actor.current()) throw invalidContractError()
		client.setQueryData(queryKey, result)
		return actor.session!.accessToken
	}
	return {
		actor,
		query,
		authorize,
		denied,
		ready:
			actor.enabled && !denied && query.isSuccess && !query.isFetching,
		refreshRelated: () => {
			if (!actor.current()) return
			void client.invalidateQueries({
				predicate: item => item.queryKey.includes(workspaceId)
			})
		}
	}
}
