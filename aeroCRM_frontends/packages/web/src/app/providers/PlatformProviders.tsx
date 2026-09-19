'use client'

import { SessionProvider } from '@/features/auth'
import { NetworkStatusProvider } from '@/features/network-status'
import { NavigationProvider } from '@/shared/lib/navigation/NavigationProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type PropsWithChildren } from 'react'
import { Toaster } from 'react-hot-toast'

// Each frontend owns its own React tree and cache. This is build-time reuse,
// not an application shared between the independent frontend containers.
export default function PlatformProviders({
	children,
	hasSessionHint
}: PropsWithChildren<{ hasSessionHint: boolean }>) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { refetchOnWindowFocus: false } }
			})
	)
	return (
		<QueryClientProvider client={queryClient}>
			<Toaster />
			<NetworkStatusProvider />
			<SessionProvider hasSessionHint={hasSessionHint}>
				<NavigationProvider>{children}</NavigationProvider>
			</SessionProvider>
		</QueryClientProvider>
	)
}
