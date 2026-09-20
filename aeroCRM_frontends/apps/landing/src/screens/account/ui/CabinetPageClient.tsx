'use client'
import styles from './AccountPage.module.scss'
import { useUser, useAuthStore } from '@/entities/user'
import { useProfileEdit } from '@/features/edit-profile'
import { useProfileIdentityBinding } from '@/features/bind-profile-identity'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import authService, {
	type IUserSession
} from '@/features/auth/api/auth.api'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'

const CRM_URL = 'https://workspace.aerocrm.space'

export default function CabinetPageClient() {
	const router = useRouter()
	const queryClient = useQueryClient()
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading: isProfileLoading } = useUser()
	const userId = auth && typeof user.id === 'string' ? user.id : null
	const profileEdit = useProfileEdit()
	const binding = useProfileIdentityBinding()
	const [name, setName] = useState('')
	const [password, setPassword] = useState('')
	const [email, setEmail] = useState('')
	const [emailCode, setEmailCode] = useState('')
	const [phone, setPhone] = useState('')
	const [phoneCode, setPhoneCode] = useState('')

	useEffect(() => {
		if (isAuthResolved && !auth)
			router.replace('/login?returnUrl=%2Fcabinet')
	}, [auth, isAuthResolved, router])
	useEffect(() => {
		if (userId) setName(user.name ?? '')
	}, [userId, user.name])

	const sessions = useQuery({
		queryKey: ['account-sessions', userId],
		queryFn: () => authService.getSessions(),
		enabled: Boolean(userId),
		retry: false
	})
	const revokeSession = useMutation({
		mutationFn: (sessionId: string) =>
			authService.revokeSession(sessionId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ['account-sessions', userId]
			})
			toast.success('Сессия завершена')
		},
		onError: () => toast.error('Не удалось завершить сессию')
	})
	const submitProfile = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!name.trim() && !password) {
			toast.error('Введите имя или новый пароль')
			return
		}
		const saved = await profileEdit.onSubmit({
			name: name.trim(),
			password
		})
		if (saved) setPassword('')
	}

	if (!isAuthResolved || !auth || isProfileLoading)
		return (
			<main className={styles.page} aria-busy="true">
				<span className={styles.srOnly} role="status">
					Загружаем личный кабинет
				</span>
				<div className={styles.loading} aria-hidden="true">
					<SkeletonLoader width={230} height={36} />
					<SkeletonLoader width="75%" height={20} />
					<div className={styles.card}>
						<SkeletonLoader count={3} height={36} />
					</div>
					<div className={styles.card}>
						<SkeletonLoader count={2} height={36} />
					</div>
				</div>
			</main>
		)
	if (!userId)
		return (
			<main className={styles.page}>
				<p role="alert">
					Не удалось загрузить профиль. Обновите страницу.
				</p>
			</main>
		)

	return (
		<main className={styles.page}>
			<h1>Личный кабинет</h1>
			<p>Личные данные и активные сессии вашего аккаунта aeroCRM.</p>
			<div className={styles.links}>
				<a href={CRM_URL}>Открыть CRM</a>
				<Link href="/payment">Подписка и оплата</Link>
			</div>

			<section className={styles.card}>
				<h2>Профиль</h2>
				<p>
					Email: {user.email || 'не указан'}
					<br />
					Телефон: {user.phone || 'не указан'}
				</p>
				<form onSubmit={submitProfile}>
					<div className={styles.fields}>
						<label className={styles.field}>
							Имя
							<input
								className={styles.input}
								value={name}
								onChange={event => setName(event.target.value)}
								autoComplete="name"
								maxLength={120}
							/>
						</label>
						<label className={styles.field}>
							Новый пароль
							<input
								className={styles.input}
								value={password}
								onChange={event => setPassword(event.target.value)}
								type="password"
								autoComplete="new-password"
								minLength={6}
							/>
						</label>
					</div>
					<p className={styles.muted}>
						Оставьте пароль пустым, если менять его не нужно.
					</p>
					<button
						className={styles.button}
						type="submit"
						disabled={profileEdit.isLoading}
					>
						Сохранить профиль
					</button>
				</form>
			</section>

			<section className={styles.card}>
				<h2>Контакты для входа</h2>
				<div className={styles.fields}>
					<div>
						<label className={styles.field}>
							Email
							<input
								className={styles.input}
								type="email"
								value={email}
								onChange={event => setEmail(event.target.value)}
								autoComplete="email"
							/>
						</label>
						<button
							className={styles.secondary}
							type="button"
							disabled={
								binding.isSendingEmailCode ||
								!email.trim() ||
								binding.emailResendSeconds > 0
							}
							onClick={() => void binding.requestEmailCode(email)}
						>
							Получить код
						</button>
						{binding.emailCodeRequested && (
							<div>
								<label className={styles.field}>
									Код из email
									<input
										className={styles.input}
										value={emailCode}
										onChange={event => setEmailCode(event.target.value)}
										inputMode="numeric"
									/>
								</label>
								<button
									className={styles.secondary}
									type="button"
									disabled={binding.isVerifyingEmailCode || !emailCode}
									onClick={() =>
										void binding.confirmEmailCode({
											email: binding.requestedEmail,
											code: emailCode
										})
									}
								>
									Подтвердить email
								</button>
							</div>
						)}
					</div>
					<div>
						<label className={styles.field}>
							Телефон
							<input
								className={styles.input}
								type="tel"
								value={phone}
								onChange={event => setPhone(event.target.value)}
								autoComplete="tel"
							/>
						</label>
						<button
							className={styles.secondary}
							type="button"
							disabled={binding.isSendingPhoneCode || !phone.trim()}
							onClick={() => void binding.requestPhoneCode(phone)}
						>
							Получить код
						</button>
						{binding.phoneCodeRequested && (
							<div>
								<label className={styles.field}>
									Код из SMS
									<input
										className={styles.input}
										value={phoneCode}
										onChange={event => setPhoneCode(event.target.value)}
										inputMode="numeric"
									/>
								</label>
								<button
									className={styles.secondary}
									type="button"
									disabled={binding.isVerifyingPhoneCode || !phoneCode}
									onClick={() =>
										void binding.confirmPhoneCode({
											phone,
											code: phoneCode
										})
									}
								>
									Подтвердить телефон
								</button>
							</div>
						)}
					</div>
				</div>
			</section>

			<section className={styles.card}>
				<h2>Сессии</h2>
				{sessions.isLoading && (
					<div aria-busy="true">
						<span className={styles.srOnly} role="status">
							Загружаем сессии
						</span>
						<div className={styles.loading} aria-hidden="true">
							<SkeletonLoader count={2} height={48} />
						</div>
					</div>
				)}
				{sessions.isError && (
					<p role="alert">Не удалось загрузить сессии.</p>
				)}
				{!sessions.isError &&
					(sessions.data as IUserSession[] | undefined)?.map(session => (
						<div className={styles.session} key={session.id}>
							<div>
								<strong>
									{session.isCurrent ? 'Текущая сессия' : 'Другая сессия'}
								</strong>
								<br />
								<span className={styles.muted}>
									{session.userAgent || 'Неизвестное устройство'} ·{' '}
									{new Date(session.lastUsedAt).toLocaleString('ru-RU')}
								</span>
							</div>
							{!session.isCurrent && (
								<button
									className={styles.secondary}
									type="button"
									disabled={revokeSession.isPending}
									onClick={() => revokeSession.mutate(session.id)}
								>
									Завершить
								</button>
							)}
						</div>
					))}
			</section>
		</main>
	)
}
