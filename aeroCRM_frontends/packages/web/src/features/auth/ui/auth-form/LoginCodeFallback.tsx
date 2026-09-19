'use client'
import authService from '../../api/auth.api'
import type {
	LoginOtpChallenge,
	LoginOtpChannel
} from '../../model/login-otp.contract'
import AuthToggle from './auth-toggle/AuthToggle'
import styles from '../AuthForm.module.scss'
import {
	PHONE_INPUT_MAX_LENGTH,
	PHONE_INPUT_PLACEHOLDER,
	formatPhoneInput,
	parsePhoneInput
} from '@/shared/lib/phone'
import { validEmail } from '@/shared/regex'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { FormEvent, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

interface Props {
	authReturnUrl?: string | null
	onAuthenticated: () => void
	onRetryCaptcha: () => void
}

// One deadline for this document, without contact details or browser persistence.
// Returning to the password form must not erase an unknown-send cooldown.
let requestRetryNotBefore = 0

const LoginCodeFallback = ({
	authReturnUrl,
	onAuthenticated,
	onRetryCaptcha
}: Props) => {
	const capabilities = useQuery({
		queryKey: ['login-otp-capabilities'],
		queryFn: () => authService.loginOtpCapabilities(),
		retry: false,
		staleTime: 30000
	})
	const [channel, setChannel] = useState<LoginOtpChannel>('EMAIL')
	const [destination, setDestination] = useState('')
	const [code, setCode] = useState('')
	const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(
		null
	)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState('')
	const [resendAt, setResendAt] = useState(() => requestRetryNotBefore)
	const [now, setNow] = useState(Date.now)
	const mounted = useRef(true)
	const inflight = useRef(false)
	const channels = capabilities.data?.channels ?? []
	const selectedChannel =
		challenge || channels.includes(channel)
			? channel
			: (channels[0] ?? 'EMAIL')
	const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000))
	const expired =
		challenge !== null && Date.parse(challenge.expiresAt) <= now
	const available =
		capabilities.data?.available === true && !capabilities.isError

	useEffect(() => {
		mounted.current = true
		const timer = window.setInterval(() => setNow(Date.now()), 1000)
		return () => {
			mounted.current = false
			window.clearInterval(timer)
		}
	}, [])

	const report = (message: string) => {
		setError(message)
		toast.error(message)
	}
	const requestCode = async () => {
		if (
			inflight.current ||
			!available ||
			!channels.includes(selectedChannel)
		)
			return
		const retryNotBefore = Math.max(resendAt, requestRetryNotBefore)
		if (Date.now() < retryNotBefore) {
			setResendAt(retryNotBefore)
			return
		}
		const contact =
			selectedChannel === 'EMAIL'
				? destination.trim().toLowerCase()
				: parsePhoneInput(destination)
		if (
			!contact ||
			(selectedChannel === 'EMAIL' && !validEmail.test(contact))
		) {
			report(
				selectedChannel === 'EMAIL'
					? 'Введите корректный email'
					: 'Введите корректный номер телефона'
			)
			return
		}
		inflight.current = true
		setPending(true)
		setError('')
		setCode('')
		// A new send may revoke the previous challenge even if its response is lost.
		setChallenge(null)
		setChannel(selectedChannel)
		// An unknown POST outcome must not trigger automatic sends.
		requestRetryNotBefore = Date.now() + 60000
		setResendAt(requestRetryNotBefore)
		try {
			const result = await authService.requestLoginOtp(
				selectedChannel,
				contact
			)
			if (!mounted.current) return
			setChallenge(result)
			requestRetryNotBefore = Math.max(
				Date.now() + 60000,
				Date.parse(result.resendAvailableAt)
			)
			setResendAt(requestRetryNotBefore)
			toast.success(
				'Если контакт подтверждён в вашем аккаунте, отправим код'
			)
		} catch (failure) {
			if (!mounted.current) return
			report(
				axios.isAxiosError(failure) && failure.response?.status === 429
					? 'Слишком много запросов. Подождите и попробуйте позже.'
					: 'Не удалось подтвердить отправку кода. Повторить запрос можно через минуту.'
			)
		} finally {
			inflight.current = false
			if (mounted.current) setPending(false)
		}
	}

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (inflight.current || !available) return
		if (!challenge) {
			await requestCode()
			return
		}
		if (expired) {
			report('Срок действия кода истёк. Запросите новый код.')
			return
		}
		if (!/^\d{6}$/.test(code)) {
			report('Введите шестизначный код')
			return
		}
		inflight.current = true
		setPending(true)
		setError('')
		try {
			await authService.verifyLoginOtp(challenge, code)
			if (!mounted.current) return
			setChallenge(null)
			setCode('')
			toast.success('Успешный вход в аккаунт')
			onAuthenticated()
		} catch (failure) {
			if (!mounted.current) return
			setCode('')
			const status = axios.isAxiosError(failure)
				? failure.response?.status
				: undefined
			report(
				status === 401
					? 'Код недействителен или срок его действия истёк. Проверьте код или запросите новый.'
					: status === 429
						? 'Слишком много попыток. Подождите и попробуйте позже.'
						: 'Не удалось завершить вход. Попробуйте ещё раз.'
			)
		} finally {
			inflight.current = false
			if (mounted.current) setPending(false)
		}
	}

	return (
		<form
			onSubmit={submit}
			className={`${styles.form} ${styles['otp-form']}`}
			aria-busy={pending}
		>
			<div className={styles['otp-notice']} role="status">
				<strong>Вход по одноразовому коду</strong>
				<p>
					CAPTCHA временно недоступна. Используйте email или телефон,
					подтверждённый в вашем аккаунте.
				</p>
			</div>
			{capabilities.isPending ? (
				<p className={styles['verification-hint']} role="status">
					Проверяем доступные способы входа…
				</p>
			) : !available ? (
				<div className={styles['verification-hint']} role="status">
					Вход по коду пока недоступен. Попробуйте загрузить CAPTCHA ещё
					раз.
					<button
						type="button"
						className={styles['link-button']}
						disabled={capabilities.isFetching}
						onClick={() => {
							toast('Проверяем резервный вход')
							void capabilities.refetch()
						}}
					>
						Проверить доступность
					</button>
				</div>
			) : (
				<>
					<fieldset
						className={styles['otp-channels']}
						disabled={pending || challenge !== null}
					>
						<legend className={styles['otp-legend']}>
							Куда отправить код
						</legend>
						{channels.map(value => (
							<label key={value} className={styles['otp-channel']}>
								<input
									type="radio"
									name="login-otp-channel"
									value={value}
									checked={selectedChannel === value}
									onChange={() => {
										setChannel(value)
										setDestination('')
										setCode('')
										setError('')
										toast(
											value === 'EMAIL'
												? 'Выбран вход по email'
												: 'Выбран вход по SMS'
										)
									}}
								/>
								{value === 'EMAIL' ? 'Email' : 'SMS'}
							</label>
						))}
					</fieldset>
					<label className={styles['otp-field']}>
						{selectedChannel === 'EMAIL'
							? 'Email аккаунта'
							: 'Телефон аккаунта'}
						<input
							type={selectedChannel === 'EMAIL' ? 'email' : 'tel'}
							autoComplete={selectedChannel === 'EMAIL' ? 'email' : 'tel'}
							required
							maxLength={
								selectedChannel === 'EMAIL' ? 254 : PHONE_INPUT_MAX_LENGTH
							}
							value={destination}
							disabled={pending || challenge !== null}
							placeholder={
								selectedChannel === 'EMAIL'
									? 'mail@example.ru'
									: PHONE_INPUT_PLACEHOLDER
							}
							onChange={event =>
								setDestination(
									selectedChannel === 'EMAIL'
										? event.target.value
										: formatPhoneInput(event.target.value)
								)
							}
						/>
					</label>
					{challenge && (
						<>
							<p className={styles['verification-hint']}>
								Если контакт подтверждён в вашем аккаунте, отправим код. Он
								действует 5 минут.
								{selectedChannel === 'EMAIL' &&
									' Проверяйте также папку «Спам».'}
							</p>
							<label className={styles['otp-field']}>
								Код из {selectedChannel === 'EMAIL' ? 'email' : 'SMS'}
								<input
									type="text"
									inputMode="numeric"
									autoComplete="one-time-code"
									pattern="[0-9]{6}"
									maxLength={6}
									value={code}
									required
									disabled={pending || expired}
									onChange={event =>
										setCode(
											event.target.value.replace(/\D/g, '').slice(0, 6)
										)
									}
									aria-describedby="login-otp-error"
								/>
							</label>
							{expired && (
								<p className={styles['verification-hint']} role="status">
									Срок действия кода истёк. Запросите новый код.
								</p>
							)}
							<div className={styles['link-actions']}>
								<button
									type="button"
									className={styles['link-button']}
									disabled={
										pending ||
										remaining > 0 ||
										!channels.includes(selectedChannel)
									}
									onClick={() => void requestCode()}
								>
									{remaining > 0
										? `Отправить повторно через ${remaining} с`
										: 'Отправить код повторно'}
								</button>
								<button
									type="button"
									className={styles['link-button']}
									disabled={pending}
									onClick={() => {
										setChallenge(null)
										setCode('')
										setError('')
										toast('Можно изменить контакт для входа')
									}}
								>
									Изменить контакт
								</button>
							</div>
						</>
					)}
					{error && (
						<p
							id="login-otp-error"
							className={styles['auth-alert']}
							role="alert"
						>
							{error}
						</p>
					)}
					<div className={styles['wrapper-button']}>
						<button
							type="submit"
							className={styles['button-primary']}
							disabled={
								pending || expired || (!challenge && remaining > 0)
							}
						>
							{pending
								? 'Подождите…'
								: challenge
									? 'Войти по коду'
									: remaining > 0
										? `Повторить через ${remaining} с`
										: 'Получить код'}
						</button>
					</div>
				</>
			)}
			<div className={styles['link-actions']}>
				<button
					type="button"
					className={styles['link-button']}
					disabled={pending}
					onClick={() => {
						toast('Повторно загружаем CAPTCHA')
						onRetryCaptcha()
					}}
				>
					Вернуться ко входу с паролем
				</button>
			</div>
			<AuthToggle isLogin authReturnUrl={authReturnUrl} />
		</form>
	)
}

export default LoginCodeFallback
