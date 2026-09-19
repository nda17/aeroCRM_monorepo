import { RestorePassword } from '@/screens/auth'
import { parseAuthReturnUrlParam } from '@/shared/lib/auth-return-url'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Восстановление пароля',
	description: 'Восстановление доступа к аккаунту aeroCRM'
}

interface IRestorePasswordPageProps {
	searchParams?: {
		returnUrl?: string | string[]
	}
}

const RestorePasswordPage = async ({
	searchParams
}: IRestorePasswordPageProps) => {
	const parsedAuthReturnUrl = parseAuthReturnUrlParam(
		searchParams?.returnUrl
	)

	return <RestorePassword authReturnUrl={parsedAuthReturnUrl ?? null} />
}

export default RestorePasswordPage
