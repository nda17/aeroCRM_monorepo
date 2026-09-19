'use client'

import { authService } from '@/features/auth'
import { clearBrowserSession } from '@/shared/api'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { useMutation } from '@tanstack/react-query'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import { useEffect } from 'react'
import toast from 'react-hot-toast'

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
		const toastId = toast.loading('Загрузка...')
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

	return null
}

export default Logout
