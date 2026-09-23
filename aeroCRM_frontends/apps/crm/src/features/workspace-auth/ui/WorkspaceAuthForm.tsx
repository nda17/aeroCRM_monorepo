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
import { useAndroidAppContext } from '@/shared/lib/pwa/app-context'
import {
	captureInvitationEmailHint,
	readInvitationEmailHint,
	rememberInvitationEmail
} from '@/shared/lib/auth-return-url'
import {
	AppIcon,
	BrandLogo,
	Button,
	ScreenState,
	TextField
} from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
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
	onAuthenticated,
	initialEmail,
	onEmailChange
}: {
	onAuthenticated: (session: AuthenticatedSession) => void
	initialEmail: string
	onEmailChange: (email: string) => void
}) => {
	const capabilities = useQuery({
		queryKey: ['workspace-login-otp-capabilities'],
		queryFn: workspaceAuthApi.loginOtpCapabilities,
		retry: false
	})
	const [channel, setChannel] = useState<LoginOtpChannel>('EMAIL')
	const [destination, setDestination] = useState(initialEmail)
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
						onChange={event => {
							setDestination(event.target.value)
							if (selectedChannel === 'EMAIL')
								onEmailChange(event.target.value)
						}}
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
	mode: requestedMode,
	returnPath,
	errorCode
}: {
	mode: AuthMode
	returnPath: string
	errorCode?: string
}) => {
	const router = useRouter()
	const androidApp = useAndroidAppContext()
	const mode =
		androidApp && requestedMode === 'register' ? 'login' : requestedMode
	const [passwordVisible, setPasswordVisible] = useState(false)
	useEffect(() => {
		if (androidApp && requestedMode === 'register') {
			router.replace(linkWithReturn('/login', returnPath))
		}
	}, [androidApp, requestedMode, returnPath, router])
	const [method, setMethod] = useState<ContactMethod>('email')
	const [stage, setStage] = useState<'credentials' | 'code'>('credentials')
	const [email, setEmail] = useState(() =>
		readInvitationEmailHint(returnPath)
	)
	useEffect(() => {
		captureInvitationEmailHint(returnPath)
	}, [returnPath])
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
		if (pending || (requestedMode === 'register' && androidApp !== false))
			return
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
			? 'Вход'
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
	const enabledProviders = providers.filter(([, , enabled]) => enabled)
	const invitationReturn = returnPath.startsWith('/invitations/')
	if (requestedMode === 'register' && androidApp !== false) {
		return <ScreenState variant="loading" title="Пожалуйста, подождите" />
	}

	return (
		<main className={styles.viewport}>
			<section className={styles.card} aria-labelledby="auth-title">
				<div className={styles.brand}>
					<BrandLogo />
				</div>
				<h1 id="auth-title">{title}</h1>
				<p className={styles.intro}>
					{mode === 'login'
						? 'Войдите в единый аккаунт aeroCRM.'
						: mode === 'register'
							? 'Создайте единый аккаунт aeroCRM.'
							: 'Получите инструкцию для восстановления доступа.'}
				</p>
				{invitationReturn ? (
					<p className={styles.intro}>
						{mode === 'register'
							? 'Создайте аккаунт с email из приглашения и подтвердите его кодом. После регистрации приглашение откроется автоматически — нажмите «Принять приглашение».'
							: mode === 'restore'
								? 'Восстановите пароль для email из приглашения, затем войдите. Приглашение откроется после входа — нажмите «Принять приглашение».'
								: 'Войдите с email из приглашения. Если аккаунта ещё нет, выберите «Создать аккаунт». После входа приглашение откроется автоматически — нажмите «Принять приглашение».'}
					</p>
				) : null}
				{mode === 'login' && isTurnstileUnavailable ? (
					<OtpFallback
						onAuthenticated={authenticated}
						initialEmail={email}
						onEmailChange={value => {
							setEmail(value)
							rememberInvitationEmail(returnPath, value)
						}}
					/>
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
							{(['email', 'phone'] as const)
								.filter(item => !invitationReturn || item === 'email')
								.map(item => (
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
								labelHidden
								placeholder="Email:"
								className={styles.authInput}
								type="email"
								autoComplete="email"
								value={email}
								onChange={event => {
									setEmail(event.target.value)
									rememberInvitationEmail(returnPath, event.target.value)
								}}
								disabled={stage === 'code'}
								required
							/>
						) : (
							<TextField
								label="Телефон"
								labelHidden
								placeholder="Телефон:"
								className={styles.authInput}
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
							<div className={styles.passwordField}>
								<TextField
									label="Пароль"
									labelHidden
									placeholder="Пароль:"
									className={`${styles.authInput} ${styles.passwordInput}`}
									type={passwordVisible ? 'text' : 'password'}
									autoComplete={
										mode === 'login' ? 'current-password' : 'new-password'
									}
									value={password}
									onChange={event => setPassword(event.target.value)}
									disabled={stage === 'code'}
									required
								/>
								<button
									type="button"
									className={styles.passwordToggle}
									aria-label={
										passwordVisible ? 'Скрыть пароль' : 'Показать пароль'
									}
									aria-pressed={passwordVisible}
									disabled={stage === 'code'}
									onClick={() => setPasswordVisible(value => !value)}
								>
									<AppIcon
										name={passwordVisible ? 'eyeOff' : 'eye'}
										size={23}
									/>
								</button>
							</div>
						) : null}
						{stage === 'code' ? (
							<TextField
								label="Код подтверждения"
								className={styles.authInput}
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
							className={styles.primaryButton}
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
						{enabledProviders.length ? (
							<>
								<div className={styles.divider}>
									<span>или продолжить через</span>
								</div>
								<div
									className={styles.social}
									aria-label="Другие способы входа"
								>
									{enabledProviders.map(([provider, label]) => (
										<a
											key={provider}
											href={workspaceAuthApi.providerUrl(
												provider,
												returnPath
											)}
										>
											<AppIcon name={provider} size={18} />
											{label}
										</a>
									))}
								</div>
							</>
						) : null}
						<nav className={styles.links}>
							{androidApp === false ? (
								<Link href={linkWithReturn('/register', returnPath)}>
									Создать аккаунт
								</Link>
							) : null}
							<Link href={linkWithReturn('/restore-password', returnPath)}>
								Забыли пароль?
							</Link>
						</nav>
					</>
				) : (
					<nav className={styles.links}>
						<Link href={linkWithReturn('/login', returnPath)}>
							{invitationReturn
								? 'У меня есть аккаунт'
								: 'Вернуться ко входу'}
						</Link>
					</nav>
				)}
			</section>
		</main>
	)
}
