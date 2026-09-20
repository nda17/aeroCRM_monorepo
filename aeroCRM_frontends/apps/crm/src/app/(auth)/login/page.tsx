import { WorkspaceAuthForm } from '@/features/workspace-auth/ui/WorkspaceAuthForm'
import { parseWorkspaceReturnPath } from '@/shared/lib/auth-return-url'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Вход' }

const LoginPage = async ({
	searchParams
}: {
	searchParams: Promise<{
		returnPath?: string | string[]
		error?: string | string[]
	}>
}) => {
	const params = await searchParams
	const returnPath =
		parseWorkspaceReturnPath(
			typeof params.returnPath === 'string' ? params.returnPath : undefined
		) ?? '/inbox'
	const errorCode =
		typeof params.error === 'string' ? params.error : undefined
	return (
		<WorkspaceAuthForm
			mode="login"
			returnPath={returnPath}
			errorCode={errorCode}
		/>
	)
}

export default LoginPage
