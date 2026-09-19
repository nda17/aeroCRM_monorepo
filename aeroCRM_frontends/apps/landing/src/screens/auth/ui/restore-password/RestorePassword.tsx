import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { withAuthReturnUrl } from '@/shared/lib/auth-return-url'
import styles from '@/screens/auth/ui/login/SignIn.module.scss'
import { RestorePasswordForm } from '@/features/auth'
import Link from '@/shared/lib/navigation/ZoneLink'
import { NextPage } from 'next'

interface IRestorePasswordProps {
	authReturnUrl?: string | null
}

const RestorePassword: NextPage<IRestorePasswordProps> = ({
	authReturnUrl
}) => {
	return (
		<section
			className={styles.wrapper}
			aria-labelledby="restore-password-title"
		>
			<div className={styles.form}>
				<h1 id="restore-password-title" className={styles.title}>
					Восстановление пароля
				</h1>
				<p className={styles.subtitle}>
					Укажите email или телефон, и мы отправим дальнейшие инструкции.
				</p>
				<RestorePasswordForm authReturnUrl={authReturnUrl} />
				<div className={styles['auth-actions']}>
					<Link
						href={withAuthReturnUrl(PUBLIC_PAGES.LOGIN, authReturnUrl)}
						className={styles['auth-link']}
					>
						Назад
					</Link>
				</div>
			</div>
		</section>
	)
}

export default RestorePassword
