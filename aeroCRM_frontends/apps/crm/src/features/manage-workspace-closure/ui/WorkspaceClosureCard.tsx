'use client'

import {
	getWorkspaceClosurePreview,
	requestWorkspaceClosure,
	type WorkspaceClosureCommand,
	type WorkspaceClosureView
} from '@/entities/workspace-closure'
import { useSessionStore } from '@/entities/session'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { Button, Drawer, ScreenState, TextField } from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { WorkspaceClosureStatus } from './WorkspaceClosureStatus'
import {
	clearClosureCommand,
	pendingClosureCommand,
	retainClosureCommand
} from '../model/closure-command'
import styles from './WorkspaceClosure.module.scss'

const WorkspaceClosureCardScoped = ({
	workspaceId
}: {
	workspaceId: string
}) => {
	const { session, sessionRevision } = useSessionStore()
	const queryClient = useQueryClient()
	const scope = `${session?.userId}:${sessionRevision}:${workspaceId}`
	const scopeRef = useRef(scope)
	const mounted = useRef(false)
	useLayoutEffect(() => {
		mounted.current = true
		scopeRef.current = scope
		return () => {
			mounted.current = false
		}
	}, [scope])
	const [open, setOpen] = useState(false)
	const [confirmation, setConfirmation] = useState('')
	const [busy, setBusy] = useState(false)
	const [sendError, setSendError] = useState(false)
	const [refusal, setRefusal] = useState<string | null>(null)
	const [resolved, setResolved] = useState<WorkspaceClosureView | null>(
		null
	)
	const current = () => {
		const live = useSessionStore.getState()
		return (
			mounted.current &&
			scopeRef.current === scope &&
			live.session?.userId === session?.userId &&
			live.session?.accessToken === session?.accessToken &&
			live.sessionRevision === sessionRevision
		)
	}
	const preview = useQuery({
		queryKey: [
			'crm-workspace-closure-preview',
			session?.userId,
			sessionRevision,
			workspaceId
		],
		queryFn: async () => {
			const value = await getWorkspaceClosurePreview(
				session!.accessToken,
				workspaceId,
				session!.userId
			)
			if (!current()) throw invalidContractError()
			return value
		},
		enabled: !!session,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const pending = pendingClosureCommand(scope)
	const closure = resolved ?? preview.data?.closure
	const send = async () => {
		if (!session || busy || !current() || closure) return
		let command: WorkspaceClosureCommand
		if (pending) {
			command = pending
		} else {
			if (!preview.data) return
			if (
				!preview.data.enabled ||
				confirmation !== preview.data.confirmationLabel
			)
				return
			command = {
				schemaVersion: 1,
				commandId: crypto.randomUUID(),
				workspaceId,
				expectedVersion: preview.data.version,
				confirmationLabel: preview.data.confirmationLabel
			}
			retainClosureCommand(scope, command)
		}
		setBusy(true)
		setSendError(false)
		setRefusal(null)
		try {
			const view = await requestWorkspaceClosure(
				session.accessToken,
				command,
				session.userId
			)
			if (!current()) return
			clearClosureCommand(scope)
			setResolved(view)
			if (preview.data)
				queryClient.setQueryData(
					[
						'crm-workspace-closure-preview',
						session.userId,
						sessionRevision,
						workspaceId
					],
					{ ...preview.data, enabled: false, closure: view }
				)
			setOpen(false)
			void queryClient.invalidateQueries({ queryKey: ['crm-access'] })
			void queryClient.invalidateQueries({
				queryKey: ['crm-workspace-closures']
			})
		} catch (error) {
			if (!current()) return
			// The POST may have committed before its response was lost. Read the
			// durable operation; an unsuccessful read never unlocks a new command.
			const result = await preview.refetch()
			if (!current()) return
			if (!result.isError && result.data?.closure) {
				clearClosureCommand(scope)
				setResolved(result.data.closure)
				setOpen(false)
			} else if (
				!result.isError &&
				result.data?.closure === null &&
				error instanceof AuthenticatedApiError &&
				(error.kind === 'validation' ||
					(error.kind === 'conflict' &&
						result.data.confirmationLabel !== command.confirmationLabel) ||
					(error.kind === 'forbidden' && !result.data.enabled))
			) {
				// These are confirmed pre-commit refusals. The refreshed preview
				// also proves this workspace has no durable closure operation.
				clearClosureCommand(scope)
				setOpen(false)
				setConfirmation('')
				setRefusal(
					!result.data.enabled
						? 'Закрытие сейчас недоступно. Проверьте состояние позже.'
						: 'Название или условия закрытия изменились. Проверьте актуальное подтверждение.'
				)
			} else {
				setSendError(true)
			}
		} finally {
			if (current()) setBusy(false)
		}
	}
	if (!session) return null
	return (
		<>
			{closure ? (
				<WorkspaceClosureStatus initial={closure} />
			) : (
				<section
					className={styles.card}
					aria-label="Закрытие рабочего пространства"
				>
					<h2>Закрытие рабочего пространства</h2>
					<p className={styles.muted}>
						Закрытие необратимо: вновь открыть это пространство нельзя. Оно
						остановит новые обращения, изменения и подписку только здесь.
						История и финансовые записи сохранятся. Ранее начатые платежи и
						сообщения могут завершиться позже.
					</p>
					{preview.isPending ? (
						<ScreenState compact variant="loading" />
					) : null}
					{preview.isError ? (
						<p className={styles.notice} role="alert">
							Не удалось проверить возможность закрытия и его текущее
							состояние.
						</p>
					) : null}
					{!preview.isError && preview.data && !preview.data.enabled ? (
						<p className={styles.notice}>
							Закрытие пространства сейчас недоступно.
						</p>
					) : null}
					{refusal ? (
						<p className={styles.notice} role="status">
							{refusal}
						</p>
					) : null}
					{pending || sendError ? (
						<p className={styles.notice} role="status">
							Результат запроса пока не подтверждён. Проверка и повтор
							используют прежнюю команду; не начинайте закрытие заново.
						</p>
					) : null}
					<div className={styles.actions}>
						<Button
							variant="secondary"
							isLoading={preview.isFetching}
							onClick={() => void preview.refetch()}
						>
							Проверить состояние
						</Button>
						<Button
							disabled={
								(!preview.data?.enabled && !pending) ||
								(preview.isError && !pending) ||
								busy
							}
							onClick={() => setOpen(true)}
						>
							{pending
								? 'Проверить прежний запрос'
								: 'Закрыть пространство'}
						</Button>
					</div>
				</section>
			)}
			<Drawer
				isOpen={open && !closure}
				onClose={() => setOpen(false)}
				title="Подтвердить закрытие пространства"
				description="Закрытие необратимо. История и финансовые записи сохранятся."
			>
				<div className={styles.dialogBody}>
					<p>
						Новые действия остановятся сразу после принятия запроса.
						Закрытие завершится после обработки уже принятых операций.
						Ранее начатые платежи и сообщения могут завершиться позже.
					</p>
					{pending ? (
						<>
							<p>
								Исходное подтверждение сохранено. Повторная проверка
								использует то же название и идентификатор запроса:
							</p>
							<p className={styles.label}>{pending.confirmationLabel}</p>
						</>
					) : preview.data ? (
						<>
							<p>
								Введите точное название пространства для подтверждения:
							</p>
							<p className={styles.label}>
								{preview.data.confirmationLabel}
							</p>
							<TextField
								label="Название пространства"
								value={confirmation}
								onChange={event => setConfirmation(event.target.value)}
								autoComplete="off"
							/>
						</>
					) : null}
					{sendError ? (
						<p className={styles.notice} role="alert">
							Результат не подтверждён. Повторите ту же команду; новый
							запрос не создаётся.
						</p>
					) : null}
					<div className={styles.actions}>
						<Button variant="secondary" onClick={() => setOpen(false)}>
							Вернуться
						</Button>
						<Button
							disabled={
								!pending &&
								(!preview.data?.enabled ||
									confirmation !== preview.data.confirmationLabel)
							}
							isLoading={busy}
							onClick={() => void send()}
						>
							{pending
								? 'Повторить прежний запрос'
								: 'Подтвердить закрытие'}
						</Button>
					</div>
				</div>
			</Drawer>
		</>
	)
}

export const WorkspaceClosureCard = ({
	workspaceId
}: {
	workspaceId: string
}) => {
	const { session, sessionRevision } = useSessionStore()
	return (
		<WorkspaceClosureCardScoped
			key={`${session?.userId}:${sessionRevision}:${workspaceId}`}
			workspaceId={workspaceId}
		/>
	)
}
