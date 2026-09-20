'use client'

import {
	useSessionStore,
	type AuthenticatedSession
} from '@/entities/session'
import { workspaceAuthApi } from '@/features/workspace-auth/api/workspace-auth.api'
import {
	type LoginOtpChallenge,
	type LoginOtpChannel
} from '@/features/workspace-auth/model/login-otp.contract'
import { useTurnstile } from '@/features/workspace-auth/model/useTurnstile'
import {
	formatCrmPhoneInput,
	parseCrmPhoneInput
} from '@/shared/lib/phone'
import { Button, TextField } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import styles from './WorkspaceAuthForm.module.scss'

type AuthMode = 'login' | 'register' | 'restore'
type ContactMethod = 'email' | 'phone'

const PASSWORD = /(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])\S{6,}/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const messageFor = (error: unknown) => {
	if (axios.isAxiosError(error)) {
		if (error.response?.status === 429)
			return 'Слишком много попыток. Подождите и попробуйте позже.'
		if (error.response?.status === 401)
			return 'Неверные данные для входа или код истёк.'
		if (error.response?.status === 503)
			return 'Сервис проверки временно недоступен. Попробуйте позже.'
	}
	return 'Не удалось выполнить запрос. Проверьте данные и попробуйте ещё раз.'
}

const linkWithReturn = (path: string, returnPath: string) =>
	`${path}?${new URLSearchParams({ returnPath })}`

const OtpFallback = ({
	onAuthenticated
}: {
	onAuthenticated: (session: AuthenticatedSession) => void
}) => {
	const capabilities = useQuery({
		queryKey: ['workspace-login-otp-capabilities'],
		queryFn: workspaceAuthApi.loginOtpCapabilities,
		retry: false
	})
	const [channel, setChannel] = useState<LoginOtpChannel>('EMAIL')
	const [destination, setDestination] = useState('')
	const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(
		null
	)
	const [code, setCode] = useState('')
	const [error, setError] = useState('')
	const [pending, setPending] = useState(false)
	const [retryNotBefore, setRetryNotBefore] = useState(0)
	const channels = capabilities.data?.channels ?? []
	const available = capabilities.data?.available === true
	const selectedChannel = channels.includes(channel)
		? channel
		: (channels[0] ?? 'EMAIL')

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (pending || !available) return
		setError('')
		setPending(true)
		try {
			if (!challenge) {
				if (Date.now() < retryNotBefore)
					throw new Error('Новый код можно запросить через минуту.')
				const contact =
					selectedChannel === 'EMAIL'
						? destination.trim().toLowerCase()
						: parseCrmPhoneInput(destination)
				if (
					!contact ||
					(selectedChannel === 'EMAIL' && !EMAIL.test(contact))
				)
					throw new Error('Введите корректный email или телефон.')
				// The request may have succeeded even when its response is lost.
				setRetryNotBefore(Date.now() + 60_000)
				setChallenge(null)
				setChallenge(
					await workspaceAuthApi.requestLoginOtp(selectedChannel, contact)
				)
				return
			}
			if (Date.parse(challenge.expiresAt) <= Date.now())
				throw new Error('Срок действия кода истёк. Запросите новый код.')
			if (!/^\d{6}$/.test(code))
				throw new Error('Введите шестизначный код.')
			onAuthenticated(
				await workspaceAuthApi.verifyLoginOtp(challenge, code)
			)
		} catch (failure) {
			setError(
				failure instanceof Error && !axios.isAxiosError(failure)
					? failure.message
					: messageFor(failure)
			)
		} finally {
			setPending(false)
		}
	}

	return (
		<form className={styles.form} onSubmit={submit}>
			<p role="status">
				CAPTCHA временно недоступна. Войдите по коду, отправленному на
				подтверждённый контакт.
			</p>
			{capabilities.isPending ? (
				<p>Проверяем доступные способы входа…</p>
			) : null}
			{!available && !capabilities.isPending ? (
				<p>Вход по коду пока недоступен. Повторите попытку позже.</p>
			) : null}
			{available && !challenge ? (
				<>
					<div
						className={styles.methodSwitch}
						role="group"
						aria-label="Способ входа по коду"
					>
						{channels.map(item => (
							<button
								key={item}
								type="button"
								aria-pressed={selectedChannel === item}
								onClick={() => setChannel(item)}
							>
								{item === 'EMAIL' ? 'Email' : 'Телефон'}
							</button>
						))}
					</div>
					<TextField
						label={selectedChannel === 'EMAIL' ? 'Email' : 'Телефон'}
						type={selectedChannel === 'EMAIL' ? 'email' : 'tel'}
						value={destination}
						onChange={event => setDestination(event.target.value)}
						required
					/>
				</>
			) : null}
			{challenge ? (
				<TextField
					label="Код из сообщения"
					inputMode="numeric"
					autoComplete="one-time-code"
					value={code}
					onChange={event => setCode(event.target.value)}
					required
				/>
			) : null}
			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}
			<Button
				type="submit"
				fullWidth
				isLoading={pending}
				disabled={!available}
			>
				{challenge ? 'Войти' : 'Получить код'}
			</Button>
			{challenge ? (
				<button
					type="button"
					className={styles.textButton}
					onClick={() => {
						setChallenge(null)
						setCode('')
					}}
				>
					Запросить новый код
				</button>
			) : null}
		</form>
	)
}

export const WorkspaceAuthForm = ({
	mode,
	returnPath,
	errorCode
}: {
	mode: AuthMode
	returnPath: string
	errorCode?: string
}) => {
	const [method, setMethod] = useState<ContactMethod>('email')
	const [stage, setStage] = useState<'credentials' | 'code'>('credentials')
	const [email, setEmail] = useState('')
	const [phone, setPhone] = useState('')
	const [password, setPassword] = useState('')
	const [code, setCode] = useState('')
	const [error, setError] = useState(
		errorCode === 'account_deactivated'
			? 'Аккаунт деактивирован. Обратитесь в поддержку.'
			: errorCode
				? 'Не удалось войти через выбранный сервис. Попробуйте ещё раз.'
				: ''
	)
	const [notice, setNotice] = useState('')
	const [pending, setPending] = useState(false)
	const action =
		mode === 'restore'
			? 'restore_password'
			: mode === 'login'
				? method === 'email'
					? 'login'
					: 'phone_login'
				: method === 'email'
					? stage === 'code'
						? 'email_register'
						: 'register'
					: stage === 'code'
						? 'phone_register'
						: 'phone_send_code'
	const {
		containerRef,
		executeTurnstile,
		isTurnstileEnabled,
		isTurnstileReady,
		isTurnstileUnavailable,
		retryTurnstile
	} = useTurnstile(action)
	const settings = useQuery({
		queryKey: ['auth-settings'],
		queryFn: workspaceAuthApi.getSettings,
		retry: false
	})
	const authenticated = (session: AuthenticatedSession) => {
		useSessionStore.getState().setAuthenticated(session)
		window.location.replace(returnPath)
	}

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (pending) return
		setError('')
		setNotice('')
		const contact =
			method === 'phone'
				? parseCrmPhoneInput(phone)
				: email.trim().toLowerCase()
		if (!contact || (method === 'email' && !EMAIL.test(contact))) {
			setError('Введите корректный email или номер телефона.')
			return
		}
		if (
			mode === 'register' &&
			stage === 'credentials' &&
			!PASSWORD.test(password)
		) {
			setError(
				'Пароль должен содержать от 6 символов, цифру, строчную и заглавную латинские буквы.'
			)
			return
		}
		if (stage === 'code' && !/^\d{4,6}$/.test(code)) {
			setError('Введите код подтверждения.')
			return
		}
		setPending(true)
		try {
			const token = await executeTurnstile(action)
			if (mode === 'login') {
				authenticated(
					method === 'email'
						? await workspaceAuthApi.login(contact, password, token)
						: await workspaceAuthApi.loginPhone(contact, password, token)
				)
			} else if (mode === 'restore') {
				await workspaceAuthApi.restorePassword(
					method === 'email' ? { email: contact } : { phone: contact },
					token
				)
				setNotice('Если контакт есть в аккаунте, инструкция отправлена.')
			} else if (stage === 'credentials') {
				if (method === 'email')
					await workspaceAuthApi.startEmailRegistration(
						contact,
						password,
						token
					)
				else await workspaceAuthApi.sendPhoneCode(contact, token)
				setStage('code')
				setNotice('Введите код, отправленный на выбранный контакт.')
			} else {
				authenticated(
					method === 'email'
						? await workspaceAuthApi.finishEmailRegistration(
								contact,
								code,
								token
							)
						: await workspaceAuthApi.registerPhone(
								contact,
								password,
								code,
								token
							)
				)
			}
		} catch (failure) {
			setError(messageFor(failure))
		} finally {
			setPending(false)
		}
	}

	const title =
		mode === 'login'
			? 'Вход в aeroCRM'
			: mode === 'register'
				? 'Регистрация'
				: 'Восстановление пароля'
	const button =
		mode === 'login'
			? 'Войти'
			: mode === 'restore'
				? 'Отправить инструкцию'
				: stage === 'code'
					? 'Подтвердить код'
					: 'Получить код'
	const providers = [
		['google', 'Google', settings.data?.googleAuthEnabled],
		['yandex', 'Яндекс', settings.data?.yandexAuthEnabled],
		['vk', 'VK', settings.data?.vkAuthEnabled]
	] as const

	return (
		<main className={styles.viewport}>
			<section className={styles.card} aria-labelledby="auth-title">
				<div className={styles.brand}>
					aeroCRM <span>Рабочее пространство</span>
				</div>
				<h1 id="auth-title">{title}</h1>
				<p className={styles.intro}>
					Один аккаунт для работы с клиентами и командой.
				</p>
				{mode === 'login' && isTurnstileUnavailable ? (
					<OtpFallback onAuthenticated={authenticated} />
				) : (
					<form
						className={styles.form}
						onSubmit={submit}
						aria-busy={pending}
					>
						<div
							className={styles.methodSwitch}
							role="group"
							aria-label="Способ авторизации"
						>
							{(['email', 'phone'] as const).map(item => (
								<button
									key={item}
									type="button"
									aria-pressed={method === item}
									disabled={pending || stage === 'code'}
									onClick={() => setMethod(item)}
								>
									{item === 'email' ? 'Email' : 'Телефон'}
								</button>
							))}
						</div>
						{method === 'email' ? (
							<TextField
								label="Email"
								type="email"
								autoComplete="email"
								value={email}
								onChange={event => setEmail(event.target.value)}
								disabled={stage === 'code'}
								required
							/>
						) : (
							<TextField
								label="Телефон"
								type="tel"
								autoComplete="tel"
								value={phone}
								onChange={event =>
									setPhone(formatCrmPhoneInput(event.target.value))
								}
								disabled={stage === 'code'}
								required
							/>
						)}
						{mode !== 'restore' ? (
							<TextField
								label="Пароль"
								type="password"
								autoComplete={
									mode === 'login' ? 'current-password' : 'new-password'
								}
								value={password}
								onChange={event => setPassword(event.target.value)}
								disabled={stage === 'code'}
								required
							/>
						) : null}
						{stage === 'code' ? (
							<TextField
								label="Код подтверждения"
								inputMode="numeric"
								autoComplete="one-time-code"
								value={code}
								onChange={event => setCode(event.target.value)}
								required
							/>
						) : null}
						{isTurnstileEnabled ? (
							<div
								className={styles.captcha}
								ref={containerRef}
								aria-label="Проверка CAPTCHA"
							/>
						) : null}
						{isTurnstileUnavailable ? (
							<button
								type="button"
								className={styles.textButton}
								onClick={retryTurnstile}
							>
								Повторить загрузку CAPTCHA
							</button>
						) : null}
						{error ? (
							<p className={styles.error} role="alert">
								{error}
							</p>
						) : null}
						{notice ? (
							<p className={styles.notice} role="status">
								{notice}
							</p>
						) : null}
						<Button
							type="submit"
							fullWidth
							isLoading={pending}
							disabled={!isTurnstileReady}
						>
							{button}
						</Button>
						{mode === 'register' &&
						stage === 'code' &&
						method === 'email' ? (
							<button
								type="button"
								className={styles.textButton}
								disabled={pending}
								onClick={async () => {
									try {
										await workspaceAuthApi.resendEmailCode(
											email.trim().toLowerCase(),
											await executeTurnstile('email_resend_code')
										)
										toast.success('Код отправлен повторно')
									} catch (failure) {
										setError(messageFor(failure))
									}
								}}
							>
								Отправить код повторно
							</button>
						) : null}
					</form>
				)}
				{mode === 'login' ? (
					<>
						<div
							className={styles.social}
							aria-label="Другие способы входа"
						>
							{providers
								.filter(([, , enabled]) => enabled)
								.map(([provider, label]) => (
									<a
										key={provider}
										href={workspaceAuthApi.providerUrl(
											provider,
											returnPath
										)}
									>
										{label}
									</a>
								))}
						</div>
						<nav className={styles.links}>
							<Link href={linkWithReturn('/register', returnPath)}>
								Создать аккаунт
							</Link>
							<Link href={linkWithReturn('/restore-password', returnPath)}>
								Забыли пароль?
							</Link>
						</nav>
					</>
				) : (
					<nav className={styles.links}>
						<Link href={linkWithReturn('/login', returnPath)}>
							Вернуться ко входу
						</Link>
					</nav>
				)}
			</section>
		</main>
	)
}
