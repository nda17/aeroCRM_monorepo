import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import authService from '@/features/auth/api/auth.api'
import { clearBrowserSession } from '@/shared/api'
import { useMutation } from '@tanstack/react-query'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import toast from 'react-hot-toast'

export const useLogout = (onClose?: () => void) => {
	const { replace } = useRouter()

	const finishLocalLogout = () => {
		clearBrowserSession({ redirectToLogin: false })
		onClose?.()
		replace(PUBLIC_PAGES.LOGIN)
	}

	const { mutate, isPending } = useMutation({
		mutationKey: ['logout'],
		mutationFn: () => authService.logout(),
		onSuccess() {
			toast.success('Вы вышли из аккаунта')
			finishLocalLogout()
		},
		onError() {
			toast.error('Не удалось подтвердить выход. Повторите попытку.')
		}
	})

	return { logout: mutate, isPending }
}
