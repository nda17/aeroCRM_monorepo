import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { useTurnstile } from '@/features/auth/model/useTurnstile'
import { useNavigationContext } from '@/shared/lib/navigation/NavigationProvider'
import authService, {
	IEmailRegistrationResponse
} from '@/features/auth/api/auth.api'
import { IFormData } from '@/features/auth/model/form.types'
import { validPhoneCode } from '@/shared/regex'
import { parsePhoneInput } from '@/shared/lib/phone'
import { useAuthStore } from '@/entities/user'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useTransition
} from 'react'
import { SubmitHandler, useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import {
	clearAuthReturnIntent,
	getSafeAuthReturnUrl
} from '@/shared/lib/auth-return-url'

const PENDING_EMAIL_REGISTRATION_STORAGE_KEY = 'pendingEmailRegistration'
const AFFILIATE_REFERRER_STORAGE_KEY = 'affiliateReferrerId'

type PendingEmailRegistrationState = IEmailRegistrationResponse & {
	deliveryStatus?: 'FAILED' | 'UNKNOWN'
}

const savePendingEmailRegistrationState = (
	payload: PendingEmailRegistrationState
) => {
	if (typeof window === 'undefined') {
		return
	}

	try {
		window.localStorage.setItem(
			PENDING_EMAIL_REGISTRATION_STORAGE_KEY,
			JSON.stringify(payload)
		)
	} catch {
		// Registration still works when browser storage is unavailable.
	}
}

const getPendingEmailRegistrationState = () => {
	if (typeof window === 'undefined') {
		return null
	}

	try {
		const rawValue = window.localStorage.getItem(
			PENDING_EMAIL_REGISTRATION_STORAGE_KEY
		)
		if (!rawValue) return null
		const value = JSON.parse(rawValue) as PendingEmailRegistrationState
		if (
			!value ||
			typeof value.email !== 'string' ||
			!value.email.trim() ||
			!Number.isFinite(Date.parse(value.expiresAt)) ||
			!Number.isFinite(Date.parse(value.resendAvailableAt)) ||
			(value.deliveryStatus !== undefined &&
				value.deliveryStatus !== 'FAILED' &&
				value.deliveryStatus !== 'UNKNOWN')
		)
			return null
		return value
	} catch {
		return null
	}
}

const clearPendingEmailRegistrationState = () => {
	if (typeof window === 'undefined') {
		return
	}

	try {
		window.localStorage.removeItem(PENDING_EMAIL_REGISTRATION_STORAGE_KEY)
	} catch {
		// Storage must not prevent completing or restarting registration.
	}
}

const getAffiliateReferrerId = () => {
	if (typeof window === 'undefined') {
		return undefined
	}

	try {
		return (
			window.localStorage
				.getItem(AFFILIATE_REFERRER_STORAGE_KEY)
				?.trim() || undefined
		)
	} catch {
		return undefined
	}
}

const clearAffiliateReferrerId = () => {
	if (typeof window === 'undefined') {
		return
	}

	try {
		window.localStorage.removeItem(AFFILIATE_REFERRER_STORAGE_KEY)
	} catch {
		// Referral persistence is optional for registration.
	}
}

const useAuthForm = (
	isLogin: boolean,
	initialAuthMessage = '',
	authReturnUrl?: string | null
) => {
	const { previousRoute } = useNavigationContext()
	const setAuth = useAuthStore(state => state.setAuth)
	const setAuthResolved = useAuthStore(state => state.setAuthResolved)

	const whiteListRedirect = ['/']
	const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email')
	const [isPhoneCodeRequested, setIsPhoneCodeRequested] = useState(false)
	const [isEmailCodeRequested, setIsEmailCodeRequested] = useState(false)
	const [emailResendAvailableAt, setEmailResendAvailableAt] = useState(0)
	const [emailDeliveryStatus, setEmailDeliveryStatus] = useState<
		'SENT' | 'FAILED' | 'UNKNOWN'
	>('SENT')
	const [now, setNow] = useState(Date.now)
	const authRequestInFlightRef = useRef(false)
	const [isAuthRequestPending, setIsAuthRequestPending] = useState(false)
	const [authMessage, setAuthMessage] = useState(initialAuthMessage)

	const {
		register,
		handleSubmit,
		reset,
		formState,
		watch,
		setValue,
		resetField,
		control
	} = useForm<IFormData>({
		mode: 'onChange'
	})
	const router = useRouter()
	const [isPending, startTransition] = useTransition()
	const queryClient = useQueryClient()
	const turnstileAction =
		authMethod === 'phone'
			? isLogin
				? 'phone_login'
				: isPhoneCodeRequested
					? 'phone_register'
					: 'phone_send_code'
			: isLogin
				? 'login'
				: isEmailCodeRequested
					? 'email_register'
					: 'register'
	const {
		containerRef: turnstileContainerRef,
		executeTurnstile,
		isTurnstileEnabled,
		isTurnstileUnavailable,
		markTurnstileUnavailable,
		retryTurnstile
	} = useTurnstile(turnstileAction)
	const emailValue = watch('email')
	const phoneValue = watch('phone')
	const loginDestination =
		previousRoute && whiteListRedirect.includes(previousRoute)
			? previousRoute
			: PUBLIC_PAGES.HOME

	const navigateAfterAuth = (fallback: string) => {
		const safeReturnUrl = getSafeAuthReturnUrl(authReturnUrl)

		if (typeof window !== 'undefined') {
			clearAuthReturnIntent(window.sessionStorage)

			if (safeReturnUrl) {
				window.location.replace(safeReturnUrl)
				return
			}
		}

		router.replace(fallback)
	}

	const clearEmailCodeStep = useCallback(() => {
		clearPendingEmailRegistrationState()
		setIsEmailCodeRequested(false)
		setEmailResendAvailableAt(0)
		setEmailDeliveryStatus('SENT')
		setValue('code', '')
	}, [setValue])

	const syncPendingEmailRegistrationState = (
		payload: PendingEmailRegistrationState
	) => {
		savePendingEmailRegistrationState(payload)
		setValue('email', payload.email)
		setValue('code', '')
		setIsEmailCodeRequested(true)
		setEmailResendAvailableAt(Date.parse(payload.resendAvailableAt))
		setEmailDeliveryStatus(payload.deliveryStatus ?? 'SENT')
		setNow(Date.now())
	}

	const handleEmailFlowError = (
		error: unknown,
		prefix: string,
		sendingTo?: string
	) => {
		const response = axios.isAxiosError(error) ? error.response : undefined
		const errorCode = response?.data?.code
		const deliveryUnknown =
			!response ||
			errorCode === 'email_delivery_unknown' ||
			(response.status >= 500 && !errorCode)
		const serverResendAt = Date.parse(response?.data?.resendAvailableAt)
		const serverExpiresAt = Date.parse(response?.data?.expiresAt)
		if (
			sendingTo &&
			(deliveryUnknown || errorCode === 'email_delivery_failed')
		) {
			// A lost response may hide a successful send. Keep code entry available
			// and require an explicit retry after the cooldown, including on reload.
			const currentTime = Date.now()
			syncPendingEmailRegistrationState({
				email: sendingTo.trim().toLowerCase(),
				expiresAt: new Date(
					Date.parse(response?.data?.expiresAt) ||
						currentTime + 10 * 60_000
				).toISOString(),
				resendAvailableAt: new Date(
					Number.isFinite(serverResendAt)
						? serverResendAt
						: currentTime + 60_000
				).toISOString(),
				deliveryStatus: deliveryUnknown ? 'UNKNOWN' : 'FAILED'
			})
		} else if (Number.isFinite(serverResendAt)) {
			setEmailResendAvailableAt(serverResendAt)
			setNow(Date.now())
			const pending = getPendingEmailRegistrationState()
			if (pending) {
				savePendingEmailRegistrationState({
					...pending,
					expiresAt: Number.isFinite(serverExpiresAt)
						? new Date(serverExpiresAt).toISOString()
						: pending.expiresAt,
					resendAvailableAt: new Date(serverResendAt).toISOString()
				})
			}
		}
		if (
			errorCode === 'email_code_not_found' ||
			errorCode === 'user_already_exists'
		) {
			clearEmailCodeStep()
		}

		const message =
			errorCode === 'email_code_attempts_exceeded'
				? 'Лимит попыток исчерпан. Новый код можно запросить после окончания таймера.'
				: deliveryUnknown
					? sendingTo
						? 'Не удалось подтвердить отправку письма. Проверьте почту и папку «Спам». Повторить запрос можно после окончания таймера.'
						: 'Не удалось подтвердить результат проверки. Попробуйте войти в аккаунт или повторите проверку кода.'
					: response?.data?.message ||
						'Не удалось выполнить запрос. Попробуйте позже.'
		setAuthMessage(message)
		toast.error(`${prefix}: ${message}`)
	}

	const handleLoginError = (error: unknown) => {
		if (
			axios.isAxiosError(error) &&
			error.response?.status === 503 &&
			error.response.data?.code === 'turnstile_unavailable'
		) {
			markTurnstileUnavailable()
		}
		const message = axios.isAxiosError(error)
			? error.response?.data?.message || 'Не удалось войти'
			: 'Не удалось войти'

		setAuthMessage(message)
		toast.error(`Ошибка входа: ${message}`)
	}

	const getErrorMessage = (error: unknown, fallback: string) => {
		if (axios.isAxiosError(error)) {
			return error.response?.data?.message || fallback
		}

		if (error instanceof Error) {
			return error.message
		}

		return fallback
	}

	const { mutateAsync: mutateLogin, isPending: isLoginPending } =
		useMutation({
			mutationKey: ['login'],
			mutationFn: ({
				data,
				token
			}: {
				data: IFormData
				token: string | null
			}) => authService.main('login', data, token),
			onSuccess() {
				startTransition(() => {
					setAuth(true)
					setAuthResolved(true)
					toast.success('Успешный вход в аккаунт')
					reset()
					navigateAfterAuth(loginDestination)
					queryClient.invalidateQueries({ queryKey: ['get-profile'] })
				})
			},
			onError(error) {
				handleLoginError(error)
			}
		})

	const {
		mutateAsync: mutateEmailSendCode,
		isPending: isEmailSendCodePending
	} = useMutation({
		mutationKey: ['email-send-code'],
		mutationFn: ({
			data,
			token
		}: {
			data: IFormData
			token: string | null
		}) =>
			authService.sendEmailCode(
				{
					email: data.email || '',
					password: data.password
				},
				token
			),
		onSuccess({ data }) {
			syncPendingEmailRegistrationState(data)
			toast.success('Код подтверждения отправлен на email')
		},
		onError(error, { data }) {
			handleEmailFlowError(error, 'Ошибка отправки кода', data.email)
		}
	})

	const {
		mutateAsync: mutateEmailRegister,
		isPending: isEmailRegisterPending
	} = useMutation({
		mutationKey: ['email-register'],
		mutationFn: ({
			data,
			token
		}: {
			data: IFormData
			token: string | null
		}) =>
			authService.registerByEmail(
				{
					email: data.email || '',
					code: data.code,
					referrerId: getAffiliateReferrerId()
				},
				token
			),
		onSuccess() {
			startTransition(() => {
				clearEmailCodeStep()
				clearAffiliateReferrerId()
				setAuth(true)
				setAuthResolved(true)
				toast.success('Email подтвержден. Регистрация завершена')
				reset()
				navigateAfterAuth(PUBLIC_PAGES.CABINET)
				queryClient.invalidateQueries({ queryKey: ['get-profile'] })
			})
		},
		onError(error) {
			handleEmailFlowError(error, 'Ошибка подтверждения email')
		}
	})

	const {
		mutateAsync: mutateEmailResendCode,
		isPending: isEmailResendCodePending
	} = useMutation({
		mutationKey: ['email-resend-code'],
		mutationFn: ({
			email,
			token
		}: {
			email: string
			token: string | null
		}) => authService.resendEmailCode({ email }, token),
		onSuccess({ data }) {
			syncPendingEmailRegistrationState(data)
			toast.success('Новый код подтверждения отправлен на email')
		},
		onError(error, { email }) {
			handleEmailFlowError(error, 'Ошибка повторной отправки', email)
		}
	})

	const {
		mutateAsync: mutatePhoneSendCode,
		isPending: isPhoneSendCodePending
	} = useMutation({
		mutationKey: ['phone-send-code'],
		mutationFn: ({
			phone,
			token
		}: {
			phone: string
			token: string | null
		}) => authService.sendPhoneCode({ phone }, token),
		onSuccess() {
			setIsPhoneCodeRequested(true)
			toast.success('Код подтверждения отправлен по SMS')
		},
		onError(error) {
			if (axios.isAxiosError(error)) {
				toast.error(
					`Ошибка отправки кода: ${error.response?.data?.message}`
				)
			}
		}
	})

	const {
		mutateAsync: mutatePhoneRegister,
		isPending: isPhoneRegisterPending
	} = useMutation({
		mutationKey: ['phone-register'],
		mutationFn: ({
			data,
			token
		}: {
			data: IFormData
			token: string | null
		}) =>
			authService.registerByPhone(
				{
					phone: data.phone || '',
					password: data.password,
					code: data.code,
					referrerId: getAffiliateReferrerId()
				},
				token
			),
		onSuccess() {
			startTransition(() => {
				setAuth(true)
				setAuthResolved(true)
				toast.success('Регистрация по номеру телефона прошла успешно')
				clearAffiliateReferrerId()
				reset()
				setIsPhoneCodeRequested(false)
				queryClient.invalidateQueries({ queryKey: ['get-profile'] })
				navigateAfterAuth(PUBLIC_PAGES.CABINET)
			})
		},
		onError(error) {
			if (axios.isAxiosError(error)) {
				toast.error(`Ошибка регистрации: ${error.response?.data?.message}`)
			}
		}
	})

	const { mutateAsync: mutatePhoneLogin, isPending: isPhoneLoginPending } =
		useMutation({
			mutationKey: ['phone-login'],
			mutationFn: ({
				data,
				token
			}: {
				data: IFormData
				token: string | null
			}) =>
				authService.loginByPhone(
					{
						phone: data.phone || '',
						password: data.password
					},
					token
				),
			onSuccess() {
				startTransition(() => {
					setAuth(true)
					setAuthResolved(true)
					toast.success('Успешный вход в аккаунт')
					reset()
					navigateAfterAuth(loginDestination)
					queryClient.invalidateQueries({ queryKey: ['get-profile'] })
				})
			},
			onError(error) {
				handleLoginError(error)
			}
		})

	useEffect(() => {
		setAuthMessage(initialAuthMessage)
	}, [initialAuthMessage])

	useEffect(() => {
		if (isLogin) {
			clearEmailCodeStep()
			setIsPhoneCodeRequested(false)
			setValue('code', '')
			resetField('phone')
			return
		}

		const pendingEmailRegistration = getPendingEmailRegistrationState()

		if (!pendingEmailRegistration) {
			return
		}

		if (
			new Date(pendingEmailRegistration.expiresAt).getTime() < Date.now()
		) {
			clearPendingEmailRegistrationState()
			return
		}

		setValue('email', pendingEmailRegistration.email)
		setValue('code', '')
		setIsEmailCodeRequested(true)
		setEmailResendAvailableAt(
			Date.parse(pendingEmailRegistration.resendAvailableAt)
		)
		setEmailDeliveryStatus(
			pendingEmailRegistration.deliveryStatus ?? 'SENT'
		)
		setNow(Date.now())
	}, [clearEmailCodeStep, isLogin, resetField, setValue])

	useEffect(() => {
		if (authMethod === 'phone') {
			clearEmailCodeStep()
			setValue('code', '')
			return
		}

		setIsPhoneCodeRequested(false)
		setValue('code', '')
		resetField('phone')
	}, [authMethod, clearEmailCodeStep, resetField, setValue])

	useEffect(() => {
		if (emailResendAvailableAt <= Date.now()) return
		const interval = window.setInterval(() => {
			const currentTime = Date.now()
			setNow(currentTime)
			if (currentTime >= emailResendAvailableAt) {
				window.clearInterval(interval)
			}
		}, 1000)
		return () => window.clearInterval(interval)
	}, [emailResendAvailableAt])

	const emailResendSeconds = Math.max(
		0,
		Math.ceil((emailResendAvailableAt - now) / 1000)
	)

	const onSubmit: SubmitHandler<IFormData> = async data => {
		if (authRequestInFlightRef.current) return
		authRequestInFlightRef.current = true
		setIsAuthRequestPending(true)
		try {
			setAuthMessage('')
			let token: string | null = null
			try {
				token = await executeTurnstile(turnstileAction)
			} catch {
				toast.error('Не удалось пройти проверку капчи')
				return
			}

			if (isTurnstileEnabled && !token) {
				toast.error('Не удалось пройти проверку капчи')
				return
			}

			if (authMethod === 'phone') {
				const phone = parsePhoneInput(data.phone || '')
				if (!phone) {
					toast.error('Введите корректный номер телефона')
					return
				}

				const phoneData = { ...data, phone }

				if (isLogin) {
					await mutatePhoneLogin({ data: phoneData, token })
					return
				}

				if (!isPhoneCodeRequested) {
					await mutatePhoneSendCode({
						phone,
						token
					})
					return
				}

				if (!data.code || !validPhoneCode.test(data.code)) {
					toast.error('Введите корректный код из SMS')
					return
				}

				await mutatePhoneRegister({ data: phoneData, token })
				return
			}

			if (isLogin) {
				await mutateLogin({ data, token })
				return
			}

			if (!isEmailCodeRequested) {
				await mutateEmailSendCode({ data, token })
				return
			}

			if (!data.code || !validPhoneCode.test(data.code)) {
				toast.error('Введите корректный код из email')
				return
			}

			await mutateEmailRegister({ data, token })
		} catch {
			// Mutation callbacks report the failure without sending again.
		} finally {
			authRequestInFlightRef.current = false
			setIsAuthRequestPending(false)
		}
	}

	const resendEmailCode = async () => {
		if (Date.now() < emailResendAvailableAt) return
		if (authRequestInFlightRef.current) return
		authRequestInFlightRef.current = true
		setIsAuthRequestPending(true)
		try {
			setAuthMessage('')
			const email = emailValue?.trim()

			if (!email) {
				toast.error('Введите email')
				return
			}

			let token: string | null = null

			try {
				token = await executeTurnstile('email_resend_code')
			} catch {
				toast.error('Не удалось пройти проверку капчи')
				return
			}

			if (isTurnstileEnabled && !token) {
				toast.error('Не удалось пройти проверку капчи')
				return
			}

			await mutateEmailResendCode({ email, token })
		} catch {
			// Mutation callbacks report the failure without sending again.
		} finally {
			authRequestInFlightRef.current = false
			setIsAuthRequestPending(false)
		}
	}

	const isLoading =
		isAuthRequestPending ||
		isPending ||
		isLoginPending ||
		isEmailSendCodePending ||
		isEmailRegisterPending ||
		isEmailResendCodePending ||
		isPhoneSendCodePending ||
		isPhoneRegisterPending ||
		isPhoneLoginPending

	return {
		turnstileContainerRef,
		isTurnstileUnavailable,
		retryTurnstile,
		completeCodeLogin: () => {
			setAuth(true)
			setAuthResolved(true)
			reset()
			void queryClient.invalidateQueries({ queryKey: ['get-profile'] })
			navigateAfterAuth(loginDestination)
		},
		register,
		control,
		handleSubmit,
		onSubmit,
		isLoading,
		formState,
		authMethod,
		setAuthMethod,
		isPhoneCodeRequested,
		isEmailCodeRequested,
		emailResendSeconds,
		emailDeliveryStatus,
		emailValue,
		phoneValue,
		resendEmailCode,
		authMessage,
		resetEmailCodeStep: () => {
			clearEmailCodeStep()
		},
		resetPhoneCodeStep: () => {
			setIsPhoneCodeRequested(false)
			setValue('code', '')
		}
	}
}

export default useAuthForm
