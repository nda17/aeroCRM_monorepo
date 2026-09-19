'use client'
import { usePreviousRoute } from '@/shared/lib/navigation/usePreviousRoute'
import type { PropsWithChildren } from 'react'
import { Suspense, createContext, useContext } from 'react'

export const useNavigationContext = () => useContext(NavigationContext)

export const NavigationProvider = ({ children }: PropsWithChildren) => {
	return (
		<Suspense fallback={children}>
			<NavigationContextProvider>{children}</NavigationContextProvider>
		</Suspense>
	)
}

const NavigationContextProvider = ({ children }: PropsWithChildren) => {
	const navigation = usePreviousRoute()

	return (
		<NavigationContext.Provider value={navigation}>
			{children}
		</NavigationContext.Provider>
	)
}

const NavigationContext = createContext<
	ReturnType<typeof usePreviousRoute>
>({
	previousRoute: null
})
