'use client'

import { getCurrentAccount, useSessionStore } from '@/entities/session'
import {
	getWorkspaceInvitation,
	type WorkspaceInvitation,
	type WorkspaceInvitationAcceptance
} from '@/entities/workspace-invitation'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { getRuntimeConfig } from '@/shared/config/runtime'
import { isUuidV4 } from '@/shared/lib/contract'
import { Button, ScreenState } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { checkInvitationCrmAccess } from '../api/invitation-access.api'
import { useAcceptInvitation } from '../model/use-accept-invitation'
import styles from './InvitationFlow.module.scss'

const safeUnavailable =
	'Приглашение не найдено или недоступно этому аккаунту. Войдите с тем адресом, на который пришло письмо, и убедитесь, что он подтверждён. Данные других приглашений не раскрываются.'

const InvitationNavigation = ({
	invitationId,
	accountLabel
}: {
	invitationId: string
	accountLabel: string
}) => (
	<nav className={styles.navigation} aria-label="Аккаунт и переходы">
		<p>Текущий аккаунт: {accountLabel}</p>
		<div className={styles.actions}>
			<a
				href={`/logout?${new URLSearchParams({
					returnPath: `/invitations/${invitationId}`
				})}`}
			>
				Войти другим аккаунтом
			</a>
			<a href="/inbox">Вернуться в CRM</a>
			<a href={getRuntimeConfig().mainAppOrigin}>На сайт</a>
		</div>
	</nav>
)

export const InvitationFlow = ({
	invitationId
}: {
	invitationId: string
}) => {
	const { session, sessionRevision } = useSessionStore()
	const account = useQuery({
		queryKey: [
			'invitation-current-account',
			session?.userId,
			sessionRevision
		],
		queryFn: () =>
			getCurrentAccount(session!.accessToken, session!.userId),
		enabled: !!session,
		retry: false,
		gcTime: 0
	})
	const accountLabel =
		account.data?.email ?? session?.userId ?? 'неизвестен'
	const [online, setOnline] = useState(true)
	useEffect(() => {
		const update = () => setOnline(navigator.onLine)
		update()
		window.addEventListener('online', update)
		window.addEventListener('offline', update)
		return () => {
			window.removeEventListener('online', update)
			window.removeEventListener('offline', update)
		}
	}, [])
	const queryKey = [
		'workspace-invitation',
		invitationId,
		session?.userId,
		sessionRevision
	] as const
	const preview = useQuery({
		queryKey,
		queryFn: () =>
			getWorkspaceInvitation(session!.accessToken, invitationId),
		enabled: !!session && isUuidV4(invitationId) && online,
		staleTime: 0,
		gcTime: 0,
		retry: false,
		refetchOnReconnect: 'always',
		refetchOnWindowFocus: false
	})
	if (!isUuidV4(invitationId))
		return (
			<ScreenState
				variant="permission"
				title="Некорректная ссылка приглашения"
				description="Проверьте ссылку из письма. Приглашение должно содержать только его идентификатор."
			/>
		)
	if (!online && !preview.data)
		return (
			<ScreenState
				variant="error"
				title="Нет подключения"
				description="Для проверки приглашения нужен доступ к серверу."
			/>
		)
	if (preview.isPending)
		return <ScreenState variant="loading" title="Проверяем приглашение" />
	const reload = () => {
		void preview.refetch()
	}
	if (!preview.data)
		return (
			<>
				<ScreenState
					variant={
						preview.error instanceof AuthenticatedApiError &&
						preview.error.kind === 'notFound'
							? 'permission'
							: 'error'
					}
					title="Не удалось открыть приглашение"
					description={
						preview.error instanceof AuthenticatedApiError &&
						preview.error.kind === 'notFound'
							? safeUnavailable
							: 'Сервис приглашений временно недоступен. Доступ к CRM не изменён.'
					}
					action={
						<Button
							onClick={reload}
							disabled={!online}
							isLoading={preview.isFetching}
						>
							Повторить проверку
						</Button>
					}
				/>
				<InvitationNavigation
					invitationId={invitationId}
					accountLabel={accountLabel}
				/>
			</>
		)
	const accepted = () => {
		// A replay proves the historical acceptance, not the current invitation
		// status: it may have been revoked since that command was committed.
		void preview.refetch()
		toast.success(
			'Принятие приглашения подтверждено. Обновляем текущий статус; допуск к CRM проверяется отдельно.'
		)
	}
	return (
		<InvitationActions
			key={`${session?.userId}:${sessionRevision}:${invitationId}`}
			invitation={preview.data}
			online={online}
			revalidating={preview.isFetching}
			failed={preview.isError}
			accountLabel={accountLabel}
			onReload={reload}
			onAccepted={accepted}
		/>
	)
}

const InvitationActions = ({
	invitation,
	online,
	revalidating,
	failed,
	accountLabel,
	onReload,
	onAccepted
}: {
	invitation: WorkspaceInvitation
	online: boolean
	revalidating: boolean
	failed: boolean
	accountLabel: string
	onReload: () => void
	onAccepted: (result: WorkspaceInvitationAcceptance) => void
}) => {
	const command = useAcceptInvitation(invitation, online, onAccepted)
	const { session, sessionRevision } = useSessionStore()
	const [checkingAccess, setCheckingAccess] = useState(false)
	const [accessMessage, setAccessMessage] = useState<string | null>(null)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const expired = invitation.status === 'EXPIRED'
	const current = () => {
		const now = useSessionStore.getState()
		return (
			mounted.current &&
			now.status === 'authenticated' &&
			now.session?.userId === session?.userId &&
			now.session?.accessToken === session?.accessToken &&
			now.sessionRevision === sessionRevision
		)
	}
	const openCrm = async () => {
		if (
			!session ||
			!online ||
			!navigator.onLine ||
			checkingAccess ||
			revalidating ||
			failed
		)
			return
		setCheckingAccess(true)
		setAccessMessage(null)
		const toastId = toast.loading('Пожалуйста, подождите')
		try {
			const result = await checkInvitationCrmAccess(
				session.accessToken,
				invitation.workspaceId,
				session.userId
			)
			if (!current()) return
			toast.success(
				result.state === 'READ_ONLY'
					? 'Подтверждён доступ только для чтения'
					: 'Доступ к aeroCRM подтверждён',
				{ id: toastId }
			)
			window.location.assign(result.destination)
		} catch (error) {
			if (!current()) return
			if (
				error instanceof AuthenticatedApiError &&
				error.kind === 'unauthorized'
			) {
				toast.dismiss(toastId)
				useSessionStore.getState().setAnonymous()
				return
			}
			const message =
				error instanceof AuthenticatedApiError &&
				error.kind === 'forbidden'
					? 'Доступ к CRM пока не подтверждён. Возможны ожидание свободного места или ограничения рабочего пространства. Обратитесь к владельцу и повторите проверку позже.'
					: 'Проверить доступ сейчас не удалось. Приглашение принято, но готовность CRM не подтверждена.'
			setAccessMessage(message)
			toast.error(message, { id: toastId })
		} finally {
			if (!current()) toast.dismiss(toastId)
			if (current()) setCheckingAccess(false)
		}
	}
	return (
		<div className={styles.content}>
			<div>
				<h2>
					{invitation.status === 'ACCEPTED'
						? 'Приглашение принято'
						: invitation.status === 'REVOKED'
							? 'Приглашение отменено'
							: expired
								? 'Срок приглашения истёк'
								: 'Вас пригласили в aeroCRM'}
				</h2>
				<p className={styles.note}>
					Рабочее пространство:{' '}
					<span className={styles.identifier}>
						{invitation.workspaceId}
					</span>
				</p>
			</div>
			{invitation.status === 'ACCEPTED' ? (
				<p>
					Identity подтвердил принятие приглашения. CRM отдельно проверяет
					роль и свободное место. До завершения допуска рабочие данные
					недоступны.
				</p>
			) : (
				<p>
					Принять приглашение может только аккаунт с подтверждённым
					адресом, на который пришло письмо.
				</p>
			)}
			{!online && (
				<p role="status">
					Нет подключения. Отправка команд приостановлена.
				</p>
			)}
			{(revalidating || failed) && (
				<p role="status">
					{revalidating
						? 'Обновляем приглашение…'
						: 'Не удалось обновить приглашение. Перед новым действием повторите проверку.'}
				</p>
			)}
			{command.error && <p role="alert">{command.error.message}</p>}
			{command.uncertain && (
				<p role="status">
					Результат предыдущего запроса не подтверждён. Повтор будет
					отправлен с тем же идентификатором и данными; новое принятие не
					создаётся.
				</p>
			)}
			{accessMessage && <p role="status">{accessMessage}</p>}
			<div className={styles.actions}>
				{command.locked ? (
					<Button
						onClick={() => command.execute()}
						disabled={!online || command.running || revalidating}
						isLoading={command.running}
					>
						Повторить тот же запрос
					</Button>
				) : (
					invitation.status === 'PENDING' &&
					!expired && (
						<Button
							disabled={!online || revalidating || failed}
							onClick={() => {
								void command.execute(() => ({
									schemaVersion: 1,
									commandId: crypto.randomUUID(),
									expectedVersion: invitation.version
								}))
							}}
						>
							Принять приглашение
						</Button>
					)
				)}
				{invitation.status === 'ACCEPTED' && !command.locked && (
					<Button
						onClick={() => void openCrm()}
						disabled={!online || revalidating || failed}
						isLoading={checkingAccess}
					>
						Проверить доступ и открыть CRM
					</Button>
				)}
				<Button
					variant="secondary"
					onClick={onReload}
					disabled={!online || command.running || checkingAccess}
					isLoading={revalidating}
				>
					Обновить приглашение
				</Button>
			</div>
			<InvitationNavigation
				invitationId={invitation.id}
				accountLabel={accountLabel}
			/>
		</div>
	)
}
