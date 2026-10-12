import PageWidthScope from '@/app/_ui/PageWidthScope'
import type { Metadata } from 'next'
import type { PropsWithChildren } from 'react'

export const metadata: Metadata = {
	robots: { index: false, follow: true }
}

const AuthLayout = ({ children }: PropsWithChildren<unknown>) => {
	return <PageWidthScope>{children}</PageWidthScope>
}

export default AuthLayout
