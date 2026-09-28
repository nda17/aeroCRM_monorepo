'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { useState } from 'react'
import { DirtyFormProvider } from '@/shared/lib/dirty-form'
import { ToastProvider } from '@/shared/ui/toast-provider'
import { useSessionStore } from '@/entities/session'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'

const readCommandOwner = () => {
	const { session, sessionRevision, status } = useSessionStore.getState()
	return status === 'authenticated' && session
		? commandOwner(session.userId, sessionRevision)
		: null
}
const subscribeCommandOwner = (notify: (owner: string | null) => void) =>
	useSessionStore.subscribe(() => notify(readCommandOwner()))

const AppProviders = ({ children }: PropsWithChildren) => {
	const { session, sessionRevision, status } = useSessionStore()
	const owner =
		status === 'authenticated' && session
			? commandOwner(session.userId, sessionRevision)
			: null
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						refetchOnWindowFocus: false,
						retry: 1,
						staleTime: 30_000
					},
					mutations: {
						retry: false
					}
				}
			})
	)

	return (
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<PendingCommandProvider
					owner={owner}
					readOwner={readCommandOwner}
					subscribeOwner={subscribeCommandOwner}
				>
					<DirtyFormProvider
						owner={owner}
						readOwner={readCommandOwner}
						subscribeOwner={subscribeCommandOwner}
					>
						{children}
					</DirtyFormProvider>
				</PendingCommandProvider>
			</ToastProvider>
		</QueryClientProvider>
	)
}

export default AppProviders
