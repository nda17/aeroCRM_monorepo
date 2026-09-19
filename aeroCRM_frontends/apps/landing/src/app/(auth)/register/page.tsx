import { SignUp } from '@/screens/auth'
import { parseAuthReturnUrlParam } from '@/shared/lib/auth-return-url'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Регистрация',
	description:
		'Создайте аккаунт aeroCRM и начните бесплатный пробный период на 10 дней'
}

interface IRegisterPageProps {
	searchParams?: {
		returnUrl?: string | string[]
	}
}

const RegisterPage = async ({ searchParams }: IRegisterPageProps) => {
	const parsedAuthReturnUrl = parseAuthReturnUrlParam(
		searchParams?.returnUrl
	)

	return <SignUp authReturnUrl={parsedAuthReturnUrl ?? null} />
}

export default RegisterPage
