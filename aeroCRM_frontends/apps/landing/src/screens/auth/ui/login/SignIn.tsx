import { AuthForm } from '@/features/auth'
import styles from '@/screens/auth/ui/login/SignIn.module.scss'
import { NextPage } from 'next'

interface ISignInProps {
	authMessage?: string
	authReturnUrl?: string | null
}

const SignIn: NextPage<ISignInProps> = ({
	authMessage,
	authReturnUrl
}) => {
	return (
		<section className={styles.wrapper} aria-labelledby="sign-in-title">
			<div className={styles.form}>
				<h1 id="sign-in-title" className={styles.title}>
					Вход
				</h1>
				<p className={styles.subtitle}>
					Войдите в единый аккаунт aeroCRM.
				</p>
				<AuthForm
					isLogin
					authMessage={authMessage}
					authReturnUrl={authReturnUrl}
				/>
			</div>
		</section>
	)
}

export default SignIn
