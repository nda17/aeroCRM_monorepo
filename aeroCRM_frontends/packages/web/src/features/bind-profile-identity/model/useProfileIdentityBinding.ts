import { errorCatch } from '@/shared/api'
import { userService } from '@/entities/user'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

export const useProfileIdentityBinding = () => {
	const queryClient = useQueryClient()
	const [requestedEmail, setRequestedEmail] = useState('')
	const requestedEmailRef = useRef('')
	const [emailDeliveryUncertain, setEmailDeliveryUncertain] =
		useState(false)
	const [emailResendAvailableAt, setEmailResendAvailableAt] = useState(0)
	const emailResendAvailableAtRef = useRef(0)
	const emailOperationRef = useRef(false)
	const [now, setNow] = useState(Date.now)
	const emailCodeRequested = Boolean(requestedEmail)
	const emailResendSeconds = Math.max(
		0,
		Math.ceil((emailResendAvailableAt - now) / 1000)
	)

	useEffect(() => {
		if (emailResendAvailableAt <= Date.now()) return
		const timer = window.setInterval(() => {
			setNow(Date.now())
			if (emailResendAvailableAt <= Date.now()) window.clearInterval(timer)
		}, 1000)
		return () => window.clearInterval(timer)
	}, [emailResendAvailableAt])

	const updateEmailCooldown = (resendAvailableAt?: string) => {
		const parsed = Date.parse(resendAvailableAt ?? '')
		const deadline = Number.isFinite(parsed) ? parsed : Date.now() + 60_000
		emailResendAvailableAtRef.current = deadline
		setEmailResendAvailableAt(deadline)
		setNow(Date.now())
	}

	const setPendingEmail = (email: string) => {
		requestedEmailRef.current = email
		setRequestedEmail(email)
	}

	const [phoneCodeRequested, setPhoneCodeRequested] = useState(false)
	const [telegramBindingRequested, setTelegramBindingRequested] =
		useState(false)
	const [
		telegramNotificationsBindingRequested,
		setTelegramNotificationsBindingRequested
	] = useState(false)

	const {
		mutateAsync: sendEmailCodeAsync,
		isPending: isSendingEmailCode
	} = useMutation({
		mutationKey: ['profile-send-email-code'],
		mutationFn: (email: string) =>
			userService.sendProfileEmailCode({ email }),
		onMutate: () => toast.loading('Пожалуйста, подождите'),
		onSuccess(response, email, toastId) {
			setPendingEmail(email)
			setEmailDeliveryUncertain(false)
			updateEmailCooldown(response.data.resendAvailableAt)
			toast.success('Код подтверждения отправлен на email', {
				id: toastId
			})
		},
		onError(error, email, toastId) {
			const response = isAxiosError(error) ? error.response : undefined
			const delivery = response?.data
			if (typeof delivery?.resendAvailableAt === 'string') {
				updateEmailCooldown(delivery.resendAvailableAt)
			}
			if (
				(isAxiosError(error) && !error.response) ||
				(response && response.status >= 500 && !delivery?.code) ||
				delivery?.code === 'email_delivery_unknown'
			) {
				setPendingEmail(email)
				setEmailDeliveryUncertain(true)
				if (typeof delivery?.resendAvailableAt !== 'string')
					updateEmailCooldown()
				toast.error(
					'Не удалось получить ответ сервера. Письмо могло отправиться: проверьте почту и папку «Спам». Если код придёт, введите его.',
					{ id: toastId }
				)
				return
			}
			toast.error(
				`Привязка email: ${errorCatch(error) || 'Не удалось отправить код. Попробуйте ещё раз.'}`,
				{ id: toastId }
			)
		}
	})

	const {
		mutateAsync: verifyEmailCodeAsync,
		isPending: isVerifyingEmailCode
	} = useMutation({
		mutationKey: ['profile-verify-email-code'],
		mutationFn: ({ email, code }: { email: string; code: string }) =>
			userService.verifyProfileEmailCode({ email, code }),
		onMutate: () => toast.loading('Пожалуйста, подождите'),
		onSuccess(_, __, toastId) {
			setPendingEmail('')
			setEmailDeliveryUncertain(false)
			toast.success('Email успешно привязан', { id: toastId })
			queryClient.invalidateQueries({ queryKey: ['get-profile'] })
		},
		onError(error, _, toastId) {
			const response = isAxiosError(error) ? error.response : undefined
			if (typeof response?.data?.resendAvailableAt === 'string') {
				updateEmailCooldown(response.data.resendAvailableAt)
			}
			const message =
				response?.data?.code === 'email_code_attempts_exceeded'
					? 'Лимит попыток исчерпан. Новый код можно запросить после окончания таймера.'
					: isAxiosError(error) && !error.response
						? 'Не удалось получить ответ сервера. Email мог быть подтверждён. Обновите страницу и проверьте профиль.'
						: errorCatch(error) ||
							'Не удалось проверить код. Попробуйте ещё раз.'
			toast.error(`Подтверждение email: ${message}`, {
				id: toastId
			})
		}
	})

	const {
		mutateAsync: sendPhoneCodeAsync,
		isPending: isSendingPhoneCode
	} = useMutation({
		mutationKey: ['profile-send-phone-code'],
		mutationFn: (phone: string) =>
			userService.sendProfilePhoneCode({ phone }),
		onMutate: () => toast.loading('Пожалуйста, подождите'),
		onSuccess(_, __, toastId) {
			setPhoneCodeRequested(true)
			toast.success('Код подтверждения отправлен по SMS', { id: toastId })
		},
		onError(error, _, toastId) {
			toast.error(`Привязка телефона: ${errorCatch(error)}`, {
				id: toastId
			})
		}
	})

	const {
		mutateAsync: verifyPhoneCodeAsync,
		isPending: isVerifyingPhoneCode
	} = useMutation({
		mutationKey: ['profile-verify-phone-code'],
		mutationFn: ({ phone, code }: { phone: string; code: string }) =>
			userService.verifyProfilePhoneCode({ phone, code }),
		onMutate: () => toast.loading('Пожалуйста, подождите'),
		onSuccess(_, __, toastId) {
			setPhoneCodeRequested(false)
			toast.success('Телефон успешно привязан', { id: toastId })
			queryClient.invalidateQueries({ queryKey: ['get-profile'] })
		},
		onError(error, _, toastId) {
			toast.error(`Подтверждение телефона: ${errorCatch(error)}`, {
				id: toastId
			})
		}
	})

	const {
		mutateAsync: startTelegramBindingAsync,
		isPending: isStartingTelegramBinding
	} = useMutation({
		mutationKey: ['profile-start-telegram-binding'],
		mutationFn: () => userService.startProfileTelegramBinding(),
		onSuccess() {
			setTelegramBindingRequested(true)
		},
		onError(error) {
			toast.error(`Привязка Telegram: ${errorCatch(error)}`)
		}
	})

	const {
		mutateAsync: unlinkTelegramBindingAsync,
		isPending: isUnlinkingTelegramBinding
	} = useMutation({
		mutationKey: ['profile-unlink-telegram-binding'],
		mutationFn: () => userService.unlinkProfileTelegramBinding(),
		onMutate: () => toast.loading('Пожалуйста, подождите'),
		onSuccess(_, __, toastId) {
			setTelegramBindingRequested(false)
			toast.success('Telegram отвязан как способ входа', {
				id: toastId
			})
			queryClient.invalidateQueries({ queryKey: ['get-profile'] })
		},
		onError(error, _, toastId) {
			toast.error(`Отвязка Telegram: ${errorCatch(error)}`, {
				id: toastId
			})
		}
	})

	const {
		mutateAsync: cancelTelegramBindingAsync,
		isPending: isCancellingTelegramBinding
	} = useMutation({
		mutationKey: ['profile-cancel-telegram-binding'],
		mutationFn: () => userService.cancelProfileTelegramBinding(),
		onSuccess() {
			setTelegramBindingRequested(false)
		},
		onError(error) {
			toast.error(`Отмена Telegram: ${errorCatch(error)}`)
		}
	})

	const {
		mutateAsync: startTelegramNotificationsAsync,
		isPending: isStartingTelegramNotifications
	} = useMutation({
		mutationKey: ['profile-start-telegram-notifications'],
		mutationFn: () => userService.startProfileTelegramNotifications(),
		onSuccess() {
			setTelegramNotificationsBindingRequested(true)
		},
		onError(error) {
			toast.error(`Telegram-уведомления: ${errorCatch(error)}`)
		}
	})

	const {
		mutateAsync: cancelTelegramNotificationsAsync,
		isPending: isCancellingTelegramNotifications
	} = useMutation({
		mutationKey: ['profile-cancel-telegram-notifications'],
		mutationFn: () => userService.cancelProfileTelegramNotifications(),
		onSuccess() {
			setTelegramNotificationsBindingRequested(false)
		},
		onError(error) {
			toast.error(`Отмена Telegram-уведомлений: ${errorCatch(error)}`)
		}
	})

	const {
		mutateAsync: disconnectTelegramNotificationsAsync,
		isPending: isDisconnectingTelegramNotifications
	} = useMutation({
		mutationKey: ['profile-disconnect-telegram-notifications'],
		mutationFn: () => userService.disconnectProfileTelegramNotifications(),
		onMutate: () => toast.loading('Пожалуйста, подождите'),
		onSuccess(_, __, toastId) {
			setTelegramNotificationsBindingRequested(false)
			toast.success('Telegram-уведомления отключены', { id: toastId })
			queryClient.invalidateQueries({
				queryKey: ['profile-telegram-notifications']
			})
		},
		onError(error, _, toastId) {
			toast.error(
				`Отключение Telegram-уведомлений: ${errorCatch(error)}`,
				{
					id: toastId
				}
			)
		}
	})

	const requestEmailCode = async (email: string) => {
		if (emailOperationRef.current) return false
		if (emailResendAvailableAtRef.current > Date.now()) return false
		const normalizedEmail = email.trim().toLowerCase()
		if (
			requestedEmailRef.current &&
			requestedEmailRef.current !== normalizedEmail
		)
			return false
		emailOperationRef.current = true
		try {
			await sendEmailCodeAsync(normalizedEmail)
			return true
		} catch {
			return false
		} finally {
			emailOperationRef.current = false
		}
	}

	const confirmEmailCode = async (payload: {
		email: string
		code: string
	}) => {
		if (emailOperationRef.current || !requestedEmailRef.current)
			return false
		if (payload.email.trim().toLowerCase() !== requestedEmailRef.current)
			return false
		emailOperationRef.current = true
		try {
			await verifyEmailCodeAsync({
				email: requestedEmailRef.current,
				code: payload.code
			})
			return true
		} catch {
			return false
		} finally {
			emailOperationRef.current = false
		}
	}

	const requestPhoneCode = async (phone: string) => {
		try {
			await sendPhoneCodeAsync(phone)
			return true
		} catch {
			return false
		}
	}

	const confirmPhoneCode = async (payload: {
		phone: string
		code: string
	}) => {
		try {
			await verifyPhoneCodeAsync(payload)
			return true
		} catch {
			return false
		}
	}

	const requestTelegramBinding = async () => {
		try {
			return await startTelegramBindingAsync()
		} catch {
			return null
		}
	}

	const requestTelegramNotificationsBinding = async () => {
		try {
			return await startTelegramNotificationsAsync()
		} catch {
			return null
		}
	}

	const unlinkTelegramBinding = async () => {
		try {
			await unlinkTelegramBindingAsync()
			return true
		} catch {
			return false
		}
	}

	const cancelTelegramBinding = async () => {
		try {
			await cancelTelegramBindingAsync()
			return true
		} catch {
			return false
		}
	}

	const cancelTelegramNotificationsBinding = async () => {
		try {
			await cancelTelegramNotificationsAsync()
			return true
		} catch {
			return false
		}
	}

	const disconnectTelegramNotifications = async () => {
		try {
			await disconnectTelegramNotificationsAsync()
			return true
		} catch {
			return false
		}
	}

	return {
		emailCodeRequested,
		requestedEmail,
		emailDeliveryUncertain,
		emailResendSeconds,
		phoneCodeRequested,
		telegramBindingRequested,
		telegramNotificationsBindingRequested,
		isSendingEmailCode,
		isVerifyingEmailCode,
		isSendingPhoneCode,
		isVerifyingPhoneCode,
		isStartingTelegramBinding,
		isUnlinkingTelegramBinding,
		isCancellingTelegramBinding,
		isStartingTelegramNotifications,
		isCancellingTelegramNotifications,
		isDisconnectingTelegramNotifications,
		requestEmailCode,
		confirmEmailCode,
		requestPhoneCode,
		confirmPhoneCode,
		requestTelegramBinding,
		requestTelegramNotificationsBinding,
		unlinkTelegramBinding,
		cancelTelegramBinding,
		cancelTelegramNotificationsBinding,
		disconnectTelegramNotifications,
		resetEmailBinding() {
			if (emailOperationRef.current) return
			setPendingEmail('')
			setEmailDeliveryUncertain(false)
		},
		resetPhoneBinding() {
			setPhoneCodeRequested(false)
		},
		resetTelegramBinding() {
			setTelegramBindingRequested(false)
		},
		resetTelegramNotificationsBinding() {
			setTelegramNotificationsBindingRequested(false)
		}
	}
}
