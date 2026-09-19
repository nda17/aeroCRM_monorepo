import { usePhoneMask } from '@/shared/lib/hooks/usePhoneMask'
import { useTurnstile } from '@/features/auth/model/useTurnstile'
import authService from '@/features/auth/api/auth.api'
import { IRestorePassword } from '@/features/auth/model/form.types'
import { validEmail, validPhone } from '@/shared/regex'
import { useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import { useEffect, useRef, useState, useTransition } from 'react'
import { FieldErrors, SubmitHandler, useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { withAuthReturnUrl } from '@/shared/lib/auth-return-url'

const useRestorePasswordForm = (authReturnUrl?: string | null) => {
	const { register, handleSubmit, reset, formState, setValue } =
		useForm<IRestorePassword>({
			mode: 'onChange'
		})
	const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email')
	const phoneInputRef = useRef<HTMLInputElement>(null)
	const phoneMask = usePhoneMask(setValue, phoneInputRef)
	const resetPhoneMask = phoneMask.reset

	const router = useRouter()

	const [isPending, startTransition] = useTransition()
	const requestInFlightRef = useRef(false)
	const [isRequestPending, setIsRequestPending] = useState(false)
	const { executeTurnstile, isTurnstileEnabled, isTurnstileReady } =
		useTurnstile()

	const {
		mutateAsync: mutateRestorePassword,
		isPending: isRestorePending
	} = useMutation({
		mutationKey: ['restore-password'],
		mutationFn: ({
			data,
			token
		}: {
			data: IRestorePassword
			token: string | null
		}) => authService.getRestorePassword(data, token),
		onSuccess() {
			startTransition(() => {
				toast.success(
					authMethod === 'phone'
						? 'Новый пароль отправлен по SMS'
						: 'Временный пароль отправлен на вашу почту'
				)
				reset()
				router.replace(withAuthReturnUrl('/login', authReturnUrl))
			})
		},
		onError(error, { data }) {
			const response = axios.isAxiosError(error)
				? error.response
				: undefined
			const unknown =
				!response ||
				response.data?.code === 'email_delivery_unknown' ||
				(response.status >= 500 && !response.data?.code)
			const message = unknown
				? data.email
					? 'Не удалось подтвердить отправку временного пароля. Проверьте почту и папку «Спам»; прежний пароль остаётся действительным.'
					: 'Не удалось подтвердить результат восстановления. Проверьте SMS перед повторным запросом.'
				: response?.data?.message &&
					  response.data.message !== 'Internal server error'
					? response.data.message
					: 'Не удалось отправить временный пароль. Попробуйте позже.'
			toast.error(`Ошибка восстановления пароля: ${message}`)
		}
	})

	useEffect(() => {
		setValue('email', '')
		setValue('phone', '')
		resetPhoneMask()
	}, [authMethod, resetPhoneMask, setValue])

	const onSubmit: SubmitHandler<IRestorePassword> = async data => {
		if (requestInFlightRef.current) return
		requestInFlightRef.current = true
		setIsRequestPending(true)
		try {
			if (!isTurnstileReady) {
				toast.error('Капча недоступна')
				return
			}

			let token: string | null = null

			try {
				token = await executeTurnstile('restore_password')
			} catch {
				toast.error('Не удалось пройти проверку капчи')
				return
			}

			if (isTurnstileEnabled && !token) {
				toast.error('Не удалось пройти проверку капчи')
				return
			}

			if (authMethod === 'phone') {
				if (!data.phone || !validPhone.test(data.phone)) {
					toast.error('Введите корректный номер телефона')
					return
				}
			} else {
				if (!data.email) {
					toast.error('Введите email')
					return
				}

				if (!validEmail.test(data.email)) {
					toast.error('Введите корректный email')
					return
				}
			}

			await mutateRestorePassword({ data, token })
		} catch {
			// The mutation callback reports an unknown outcome without retrying.
		} finally {
			requestInFlightRef.current = false
			setIsRequestPending(false)
		}
	}

	const onInvalid = (errors: FieldErrors<IRestorePassword>) => {
		if (authMethod === 'phone') {
			const message =
				errors.phone?.message || 'Введите корректный номер телефона'

			toast.error(String(message))
			return
		}

		const message = errors.email?.message || 'Введите корректный email'
		toast.error(String(message))
	}

	const isLoading = isPending || isRestorePending || isRequestPending

	return {
		register,
		handleSubmit,
		onSubmit,
		onInvalid,
		isLoading,
		formState,
		authMethod,
		setAuthMethod,
		phoneInputRef,
		phoneMask
	}
}

export default useRestorePasswordForm
