'use client'

import { useQuery } from '@tanstack/react-query'
import { listMailboxes } from '@/entities/mail/api/mail.api'
import { useMailContext } from './use-mail-context'

export const useMailAvailability = () => {
	const context = useMailContext({ pollAfterError: true })
	const readable =
		!!context.session &&
		context.current() &&
		!context.capabilities.isError &&
		context.capabilities.data?.enabled === true &&
		context.capabilities.data.mailPermissions.includes('mail:read')
	const mailboxes = useQuery({
		queryKey: ['mail-mailboxes', ...context.key],
		enabled: readable,
		queryFn: () =>
			listMailboxes(
				context.session!.accessToken,
				context.workspace.workspaceId
			),
		gcTime: 0,
		staleTime: 0,
		retry: false,
		refetchInterval: readable ? 15_000 : false
	})
	const available =
		readable && !mailboxes.isError
			? (mailboxes.data?.items.filter(
					item =>
						item.state !== 'DISCONNECTED' &&
						item.permissions.includes('read')
				) ?? [])
			: []
	const enabled = available.length > 0
	const loading =
		!!context.session &&
		(context.capabilities.isPending || (readable && mailboxes.isPending))
	const reason = loading
		? 'Проверяем доступ к подключённой почте…'
		: context.capabilities.isError || mailboxes.isError
			? 'Не удалось проверить доступ к почте. Откройте раздел позже.'
			: !readable
				? 'Почта недоступна в этом пространстве или у вас нет права чтения.'
				: 'Нет доступного подключённого ящика. Подключите его в «Настройки → Почта» или запросите доступ у администратора.'
	const refresh = async () => {
		const fresh = await context.capabilities.refetch()
		if (
			!context.current() ||
			fresh.isError ||
			!fresh.data?.enabled ||
			!fresh.data.mailPermissions.includes('mail:read')
		)
			return false
		const result = await mailboxes.refetch()
		return context.current() && !result.isError
	}
	return {
		context,
		mailboxes,
		available,
		enabled,
		loading,
		reason,
		refresh
	}
}
