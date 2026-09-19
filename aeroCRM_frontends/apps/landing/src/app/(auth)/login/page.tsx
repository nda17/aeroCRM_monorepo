import { SignIn } from '@/screens/auth'
import { parseAuthReturnUrlParam } from '@/shared/lib/auth-return-url'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Вход',
	description: 'Войдите в личный кабинет aeroCRM'
}

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
	account_deactivated:
		'Учетная запись деактивирована, обработка персональных данных отозвана. Для повторной активации аккаунта обратитесь в техподдержку info@aerocrm.space'
}

interface ILoginPageProps {
	searchParams?: {
		error?: string | string[]
		returnUrl?: string | string[]
	}
}

const LoginPage = async ({ searchParams }: ILoginPageProps) => {
	const errorCode = Array.isArray(searchParams?.error)
		? searchParams?.error[0]
		: searchParams?.error
	const parsedAuthReturnUrl = parseAuthReturnUrlParam(
		searchParams?.returnUrl
	)
	const authReturnUrl =
		parsedAuthReturnUrl === undefined && !errorCode
			? null
			: parsedAuthReturnUrl

	return (
		<SignIn
			authMessage={errorCode ? LOGIN_ERROR_MESSAGES[errorCode] : undefined}
			authReturnUrl={authReturnUrl}
		/>
	)
}

export default LoginPage
