'use client'
import { authService } from '@/features/auth'
import { useAuthStore } from '@/entities/user'
import { clearBrowserSession } from '@/shared/api'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { NextPage } from 'next'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import styles from '@/screens/auth/ui/login/SignIn.module.scss'
import {
	clearAuthReturnIntent,
	readAuthReturnIntent
} from '@/shared/lib/auth-return-url'

const AFFILIATE_REFERRER_STORAGE_KEY = 'affiliateReferrerId'
const SOCIAL_AUTH_TOAST_ID = 'social-auth'

const SocialAuthPage: NextPage = () => {
	const router = useRouter()
	const setAuth = useAuthStore(state => state.setAuth)
	const setAuthResolved = useAuthStore(state => state.setAuthResolved)

	useEffect(() => {
		const toastId = toast.loading('Пожалуйста, подождите', {
			id: SOCIAL_AUTH_TOAST_ID
		})
		const authReturnUrl = readAuthReturnIntent(window.sessionStorage)

		authService
			.getNewTokens()
			.then(() => {
				window.localStorage.removeItem(AFFILIATE_REFERRER_STORAGE_KEY)
				setAuth(true)
				setAuthResolved(true)
				toast.success('Вы вошли в аккаунт', { id: toastId })
				clearAuthReturnIntent(window.sessionStorage)

				if (authReturnUrl) {
					window.location.replace(authReturnUrl)
					return
				}

				router.replace(PUBLIC_PAGES.HOME)
			})
			.catch(() => {
				clearBrowserSession({ redirectToLogin: false })
				toast.error('Ошибка авторизации через социальную сеть', {
					id: toastId
				})
				router.replace(PUBLIC_PAGES.LOGIN)
			})
	}, [router, setAuth, setAuthResolved])

	return (
		<main className={styles.wrapper} aria-busy="true">
			<div className={styles.form}>
				<span className="sr-only" role="status">
					Проверяем вход
				</span>
				<div className="flex flex-col gap-4" aria-hidden="true">
					<SkeletonLoader width="60%" height={32} />
					<SkeletonLoader count={2} height={20} />
				</div>
			</div>
		</main>
	)
}

export default SocialAuthPage
