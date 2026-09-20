'use client'

import { authService } from '@/features/auth'
import { clearBrowserSession } from '@/shared/api'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { useMutation } from '@tanstack/react-query'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import styles from '@/screens/auth/ui/login/SignIn.module.scss'

const Logout = () => {
	const { replace } = useRouter()

	const { mutateAsync: mutateLogout } = useMutation({
		mutationKey: ['logout'],
		mutationFn: () => authService.logout(),
		retry: true,
		retryDelay: attempt => Math.min(1000 * 2 ** attempt, 10_000),
		onSuccess() {
			clearBrowserSession({ redirectToLogin: false })
		}
	})

	useEffect(() => {
		const toastId = toast.loading('Пожалуйста, подождите', {
			id: 'logout'
		})
		const logout = async () => {
			try {
				await mutateLogout()
				toast.success('Вы вышли из аккаунта', { id: toastId })
				replace(PUBLIC_PAGES.LOGIN)
			} catch {
				toast.error(
					'Не удалось подтвердить выход. Обновите страницу для повторной попытки.',
					{
						id: toastId
					}
				)
			}
		}

		void logout()
	}, [mutateLogout, replace])

	return (
		<main className={styles.wrapper} aria-busy="true">
			<div className={styles.form}>
				<span className="sr-only" role="status">
					Завершаем сессию
				</span>
				<div className="flex flex-col gap-4" aria-hidden="true">
					<SkeletonLoader width="60%" height={32} />
					<SkeletonLoader count={2} height={20} />
				</div>
			</div>
		</main>
	)
}

export default Logout
