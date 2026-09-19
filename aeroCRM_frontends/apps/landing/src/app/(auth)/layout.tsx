import PageWidthScope from '@/app/_ui/PageWidthScope'
import type { PropsWithChildren } from 'react'

const AuthLayout = ({ children }: PropsWithChildren<unknown>) => {
	return <PageWidthScope>{children}</PageWidthScope>
}

export default AuthLayout
