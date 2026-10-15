'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { marketingEmailService } from '@/features/marketing-email/api/marketing-email.api'
import {
	MARKETING_EMAIL_CONSENT_TEXT,
	type MarketingEmailCommand
} from '@/features/marketing-email/model/marketing-email.contract'
import {
	ActorMutationNotSentError,
	isMutationActorCurrent,
	readMutationActor,
	type MutationActor
} from '@/shared/api/actor-bound-mutation'
import styles from './AccountPage.module.scss'

export default function MarketingEmailSettings({
	userId,
	hidden
}: {
	userId: string
	hidden: boolean
}) {
	const client = useQueryClient()
	const key = ['marketing-email', userId] as const
	const query = useQuery({
		queryKey: key,
		queryFn: marketingEmailService.get,
		retry: false,
		staleTime: 0
	})
	const [draft, setDraft] = useState<boolean | null>(null)
	const [pending, setPending] = useState<{
		actor: MutationActor
		command: MarketingEmailCommand
	} | null>(null)
	const [running, setRunning] = useState(false)
	const [review, setReview] = useState(false)
	const [message, setMessage] = useState('')
	const inFlight = useRef(false)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const current = query.data
	const enabled = draft ?? current?.enabled ?? false
	const dirty = draft !== null && draft !== current?.enabled
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (!dirty && !pending) return
			event.preventDefault()
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', warn)
		return () => window.removeEventListener('beforeunload', warn)
	}, [dirty, pending])
	const save = async (event: FormEvent) => {
		event.preventDefault()
		if (
			inFlight.current ||
			!current ||
			review ||
			query.isError ||
			query.isFetching
		)
			return
		let attempt = pending
		try {
			if (!attempt)
				attempt = {
					actor: readMutationActor(userId),
					command: {
						schemaVersion: 1,
						commandId: crypto.randomUUID(),
						expectedVersion: current.version,
						expectedEmailBinding: current.emailBinding,
						enabled,
						consentTextVersion: current.consentTextVersion
					}
				}
			inFlight.current = true
			setRunning(true)
			setPending(attempt)
			setMessage('')
			const result = await marketingEmailService.save(
				attempt.actor,
				attempt.command
			)
			if (!mounted.current || !isMutationActorCurrent(attempt.actor))
				return
			client.setQueryData(key, result)
			setDraft(null)
			setPending(null)
			setMessage(
				result.enabled
					? 'Согласие сохранено.'
					: 'Маркетинговые письма отключены.'
			)
		} catch (error) {
			if (!mounted.current) return
			if (isAxiosError(error) && error.response?.status === 409) {
				setDraft(attempt?.command.enabled ?? enabled)
				setPending(null)
				setReview(true)
				setMessage(
					'Email или настройки изменились. Ваш выбор сохранён. Обновите данные и подтвердите его для актуального адреса.'
				)
				void query.refetch()
			} else if (
				isAxiosError(error) &&
				[400, 403, 404, 422].includes(error.response?.status ?? 0)
			) {
				setPending(null)
				setMessage(
					'Не удалось сохранить согласие. Проверьте адрес и доступ к аккаунту, затем обновите данные.'
				)
			} else if (error instanceof ActorMutationNotSentError && !pending) {
				setPending(null)
				setMessage(error.message)
			} else {
				setMessage(
					'Результат сохранения не подтверждён. Обновите данные и повторите ту же команду; новый запрос не создаётся.'
				)
			}
		} finally {
			inFlight.current = false
			if (mounted.current) setRunning(false)
		}
	}
	return (
		<section
			className={styles.card}
			hidden={hidden}
			aria-labelledby="marketing-email-title"
		>
			<h2 id="marketing-email-title">Маркетинговые письма</h2>
			<p className={styles.muted}>
				Новости и предложения aeroCRM. Эти настройки не влияют на коды
				входа, оплату и необходимые сообщения сервиса. Согласие относится
				только к email.
			</p>
			{query.isPending ? <p role="status">Загружаем настройки…</p> : null}
			{query.isError ? (
				<p role="alert">Не удалось загрузить актуальные настройки.</p>
			) : null}
			{current ? (
				<form onSubmit={event => void save(event)}>
					<p>
						Email: <strong>{current.email ?? 'не указан'}</strong> ·{' '}
						{current.emailVerified ? 'подтверждён' : 'не подтверждён'}
					</p>
					{!current.emailVerified ? (
						<p className={styles.muted}>
							Чтобы включить маркетинговые письма, сначала подтвердите
							email в разделе «Контакты для входа».
						</p>
					) : null}
					<label className={styles.consent}>
						<input
							type="checkbox"
							checked={enabled}
							disabled={
								running ||
								!!pending ||
								review ||
								!current.emailVerified ||
								query.isError ||
								query.isFetching
							}
							onChange={event => {
								setDraft(event.target.checked)
								setMessage('')
							}}
						/>
						<span>{MARKETING_EMAIL_CONSENT_TEXT}</span>
					</label>
					<p className={styles.muted}>
						{current.enabled
							? 'Действующее согласие включено.'
							: 'Действующего согласия нет.'}
					</p>
					{review ? (
						<button
							className={styles.secondary}
							type="button"
							disabled={query.isFetching || query.isError}
							onClick={() => {
								setReview(false)
								setMessage(
									'Проверьте выбранный email и нажмите «Сохранить мой выбор».'
								)
							}}
						>
							Использовать актуальные данные для моего выбора
						</button>
					) : (
						<button
							className={styles.button}
							type="submit"
							disabled={
								running ||
								query.isError ||
								query.isFetching ||
								(!pending &&
									(!dirty || (enabled && !current.emailVerified)))
							}
						>
							{running
								? 'Сохраняем…'
								: pending
									? 'Повторить ту же команду'
									: 'Сохранить мой выбор'}
						</button>
					)}
				</form>
			) : null}
			{message ? (
				<p className={styles.contactFollowup} role="status">
					{message}
				</p>
			) : null}
			<button
				className={`${styles.secondary} ${styles.contactButton}`}
				type="button"
				disabled={query.isFetching || running}
				onClick={() => void query.refetch()}
			>
				Обновить настройки
			</button>
		</section>
	)
}
