'use client'

import {
	getEmployeeProfile,
	normalizeEmployeeName,
	type EmployeeName,
	type EmployeeProfileResponse
} from '@/entities/crm-team'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { Button, Drawer, ReadOnlyBanner, ScreenState } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useEmployeeProfileCommand } from '../model/use-employee-profile-command'
import type { useTeamSession } from '../model/use-team-session'
import { EmployeeNameFields } from './EmployeeNameFields'
import styles from './TeamEditor.module.scss'

type Context = ReturnType<typeof useTeamSession>
const description =
	'ФИО используется только в этом CRM-пространстве. Общий аккаунт, доступ и текущие назначения задач не изменятся.'

export const EmployeeProfileControl = ({
	context,
	targetSubject,
	allowEdit = true,
	disabled = false
}: {
	context: Context
	targetSubject: string
	allowEdit?: boolean
	disabled?: boolean
}) => {
	const [open, setOpen] = useState(false)
	const self = targetSubject === context.session?.userId
	const canRead =
		!disabled &&
		!!context.session &&
		context.confirmed &&
		context.permissions.data?.subject === context.session.userId &&
		context.permissions.data?.workspaceId ===
			context.workspace.workspaceId &&
		(self || context.canRead)
	const canWrite =
		canRead &&
		allowEdit &&
		context.workspace.canWrite &&
		context.permissions.data?.state !== 'READ_ONLY' &&
		(self || context.canManage)
	return (
		<>
			<Button
				size="sm"
				variant="secondary"
				disabled={!canRead}
				onClick={() => setOpen(true)}
			>
				{self ? 'Моё ФИО' : 'ФИО'}
			</Button>
			{open && canRead ? (
				<EmployeeProfileDialog
					key={`${context.key.join(':')}:${targetSubject}`}
					context={context}
					targetSubject={targetSubject}
					canWrite={canWrite}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	)
}

const EmployeeProfileDialog = ({
	context,
	targetSubject,
	canWrite,
	onClose
}: {
	context: Context
	targetSubject: string
	canWrite: boolean
	onClose: () => void
}) => {
	const { session, workspace, sessionRevision } = context
	const profile = useQuery({
		queryKey: ['crm-employee-profile', ...context.key, targetSubject],
		queryFn: () =>
			getEmployeeProfile(session!.accessToken, {
				workspaceId: workspace.workspaceId,
				subject: session!.userId,
				targetSubject
			}),
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false
	})
	const review = async () => {
		const result = await profile.refetch()
		const current = useSessionStore.getState()
		if (
			result.error ||
			!result.data ||
			current.session?.accessToken !== session?.accessToken ||
			current.sessionRevision !== sessionRevision
		)
			throw new Error('Не удалось подтвердить актуальные данные профиля.')
		return result.data
	}
	const accessDenied =
		profile.error instanceof AuthenticatedApiError &&
		['unauthorized', 'forbidden', 'notFound'].includes(profile.error.kind)
	// Transport refetch never overwrites a draft; a fresh denial hides PII.
	if (profile.data && !accessDenied)
		return (
			<EmployeeProfileForm
				context={context}
				initial={profile.data}
				canWrite={canWrite}
				onClose={onClose}
				onReview={review}
			/>
		)
	return (
		<Drawer
			isOpen
			title="ФИО сотрудника"
			description={description}
			onClose={onClose}
		>
			<ScreenState
				compact
				variant={profile.isError ? 'error' : 'loading'}
				description={profile.error?.message}
				action={
					profile.isError ? (
						<Button onClick={() => void profile.refetch()}>
							Повторить
						</Button>
					) : undefined
				}
			/>
		</Drawer>
	)
}

const EmployeeProfileForm = ({
	context,
	initial,
	canWrite,
	onClose,
	onReview
}: {
	context: Context
	initial: EmployeeProfileResponse
	canWrite: boolean
	onClose: () => void
	onReview: () => Promise<EmployeeProfileResponse>
}) => {
	const names = (value: EmployeeProfileResponse): EmployeeName => ({
		firstName: value.profile?.firstName ?? '',
		lastName: value.profile?.lastName ?? '',
		middleName: value.profile?.middleName ?? null
	})
	const [draft, setDraft] = useState(() => names(initial))
	const [version, setVersion] = useState(initial.profile?.version ?? 0)
	const [error, setError] = useState('')
	const [reviewing, setReviewing] = useState(false)
	const command = useEmployeeProfileCommand(
		context,
		initial.targetSubject,
		canWrite,
		onClose
	)
	const locked = command.locked || reviewing
	const close = () => {
		if (command.canClose()) onClose()
	}
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (locked) return
		const profile = normalizeEmployeeName(draft)
		if (!profile) {
			const message = 'Проверьте имя и фамилию. Отчество необязательно.'
			setError(message)
			toast.error(message)
			return
		}
		void command.execute({ profile, expectedVersion: version })
	}
	const review = async () => {
		if (command.uncertain || command.running || reviewing) return
		setReviewing(true)
		try {
			const fresh = await onReview()
			if (command.reset()) {
				setDraft(names(fresh))
				setVersion(fresh.profile?.version ?? 0)
				setError('')
				toast('Данные обновлены. Проверьте ФИО перед сохранением.')
			}
		} catch {
			toast.error(
				'Не удалось обновить профиль. Введённые данные сохранены в форме.'
			)
		} finally {
			setReviewing(false)
		}
	}
	return (
		<Drawer
			isOpen
			title="ФИО сотрудника"
			description={description}
			onClose={close}
		>
			<form className={styles.form} onSubmit={submit}>
				{!canWrite ? (
					<ReadOnlyBanner description="Просмотр ФИО доступен. Изменение ограничено вашей ролью или состоянием подписки." />
				) : null}
				<EmployeeNameFields
					value={draft}
					disabled={locked}
					onChange={value => {
						setDraft(value)
						setError('')
					}}
				/>
				{error ? (
					<p className={styles.error} role="alert">
						{error}
					</p>
				) : null}
				{command.error ? (
					<div className={styles.error} role="alert">
						<p>{command.error.message}</p>
						{command.uncertain ? (
							<>
								<p>
									Результат не подтверждён. Повторный запрос проверит ту же
									команду без изменения данных.
								</p>
								<Button
									variant="secondary"
									disabled={!command.enabled || command.running}
									isLoading={command.running}
									onClick={() => void command.execute()}
								>
									Проверить результат
								</Button>
							</>
						) : command.blocked ? (
							<Button
								variant="secondary"
								disabled={reviewing}
								isLoading={reviewing}
								onClick={() => void review()}
							>
								Перечитать и проверить
							</Button>
						) : null}
					</div>
				) : null}
				<div className={styles.actions}>
					<Button variant="secondary" onClick={close}>
						{canWrite ? 'Отмена' : 'Закрыть'}
					</Button>
					{canWrite ? (
						<Button
							type="submit"
							disabled={locked}
							isLoading={command.running}
						>
							Сохранить ФИО
						</Button>
					) : null}
				</div>
			</form>
		</Drawer>
	)
}
