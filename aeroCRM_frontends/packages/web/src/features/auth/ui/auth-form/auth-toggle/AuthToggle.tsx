import { IAuthToggle } from '@/features/auth/ui/auth-form/auth-toggle/auth-toggle.interface'
import styles from '@/features/auth/ui/auth-form/auth-toggle/AuthToggle.module.scss'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { withAuthReturnUrl } from '@/shared/lib/auth-return-url'
import clsx from 'clsx'
import { NextPage } from 'next'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'

const AuthToggle: NextPage<IAuthToggle> = ({ isLogin, authReturnUrl }) => {
	const router = useRouter()
	const authPage = (path: string) => withAuthReturnUrl(path, authReturnUrl)

	return (
		<div className={styles.wrapper}>
			{isLogin ? (
				<p className={clsx(styles['toggle-link-block'])}>
					Нет аккаунта?{' '}
					<button
						type="button"
						className={clsx(styles['sign-up-button'])}
						onClick={() => router.push(authPage(PUBLIC_PAGES.REGISTER))}
					>
						Зарегистрироваться
					</button>
				</p>
			) : (
				<p className={clsx(styles['toggle-link-block'])}>
					Уже зарегистрированы?{' '}
					<button
						type="button"
						className={clsx(styles['sign-in-button'])}
						onClick={() => router.push(authPage(PUBLIC_PAGES.LOGIN))}
					>
						Войти
					</button>
				</p>
			)}
			<p className={clsx(styles['toggle-link-block'])}>
				<button
					type="button"
					className={clsx(styles['restore-password-button'])}
					onClick={() =>
						router.push(authPage(PUBLIC_PAGES.RESTORE_PASSWORD))
					}
				>
					Забыли пароль?
				</button>
			</p>
		</div>
	)
}

export default AuthToggle
