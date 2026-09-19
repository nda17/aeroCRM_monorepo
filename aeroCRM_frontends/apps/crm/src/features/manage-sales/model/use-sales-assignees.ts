'use client'

import { useAssigneeLabels } from '@/entities/crm-team'
import { useSessionStore } from '@/entities/session'
import { useLayoutEffect, useRef } from 'react'
import type { useSalesSession } from './use-sales-session'

export const useSalesAssignees = (
	context: ReturnType<typeof useSalesSession>,
	subjects: readonly string[]
) => {
	const signature = JSON.stringify([context.key, context.canRead])
	const latest = useRef(signature)
	useLayoutEffect(() => {
		latest.current = signature
		return () => {
			latest.current = ''
		}
	}, [signature])
	const labels = useAssigneeLabels(
		{
			workspaceId: context.workspace.workspaceId,
			subject: context.session?.userId,
			accessToken: context.session?.accessToken,
			sessionRevision: context.sessionRevision,
			canRead: context.canRead,
			authority: context.permissions.data,
			isCurrent: () => {
				const state = useSessionStore.getState()
				return (
					context.canRead &&
					state.status === 'authenticated' &&
					latest.current === signature &&
					state.session?.userId === context.session?.userId &&
					state.session?.accessToken === context.session?.accessToken &&
					state.sessionRevision === context.sessionRevision
				)
			}
		},
		subjects.map(subject => ({ subject, membershipId: null }))
	)
	return (subject: string) => {
		if (subject === context.session?.userId) return 'Вы'
		const employee = labels.lookup({
			subject,
			membershipId: null
		})?.employee
		return (
			employee?.displayName ||
			employee?.verifiedEmail ||
			(labels.loading
				? 'Загрузка имени…'
				: labels.error
					? 'Имя временно недоступно'
					: 'Сотрудник недоступен')
		)
	}
}
