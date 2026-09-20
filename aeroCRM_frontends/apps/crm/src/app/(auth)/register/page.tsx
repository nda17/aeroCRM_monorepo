import { WorkspaceAuthForm } from '@/features/workspace-auth/ui/WorkspaceAuthForm'
import { parseWorkspaceReturnPath } from '@/shared/lib/auth-return-url'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Регистрация' }

const RegisterPage = async ({
	searchParams
}: {
	searchParams: Promise<{ returnPath?: string | string[] }>
}) => {
	const params = await searchParams
	const returnPath =
		parseWorkspaceReturnPath(
			typeof params.returnPath === 'string' ? params.returnPath : undefined
		) ?? '/inbox'
	return <WorkspaceAuthForm mode="register" returnPath={returnPath} />
}

export default RegisterPage
