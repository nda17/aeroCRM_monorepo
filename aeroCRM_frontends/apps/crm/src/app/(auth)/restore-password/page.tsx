import { WorkspaceAuthForm } from '@/features/workspace-auth/ui/WorkspaceAuthForm'
import { parseWorkspaceReturnPath } from '@/shared/lib/auth-return-url'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Восстановление пароля' }

const RestorePasswordPage = async ({
	searchParams
}: {
	searchParams: Promise<{ returnPath?: string | string[] }>
}) => {
	const params = await searchParams
	const returnPath =
		parseWorkspaceReturnPath(
			typeof params.returnPath === 'string' ? params.returnPath : undefined
		) ?? '/inbox'
	return <WorkspaceAuthForm mode="restore" returnPath={returnPath} />
}

export default RestorePasswordPage
