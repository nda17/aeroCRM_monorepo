'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type {
	useWorkdaySession,
	WorkdayCommand,
	WorkdayTask
} from '@/entities/crm-workday'
import { getSalesDeal, type SalesDeal } from '@/entities/sales'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { Button } from '@/shared/ui'
import styles from './WorkdayTaskDrawer.module.scss'

export interface WorkdayCompletion {
	task: WorkdayTask
	command: WorkdayCommand
	scopeKey: string
}
interface Props {
	completion: WorkdayCompletion
	context: ReturnType<typeof useWorkdaySession>
	disabled?: boolean
	onCreate: (deal: SalesDeal | null) => boolean | void
	onDismiss: () => void
}

// This component receives a consumed command result, never an optimistic task
// or a read-side COMPLETED row. It offers a new draft, not a chained mutation.
export const WorkdayNextTaskSuggestion = (props: Props) => {
	const { completion, context, disabled = false, onDismiss } = props
	const { task, command, scopeKey } = completion
	const [checking, setChecking] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const mounted = useRef(true)
	const pending = useRef(false)
	const opened = useRef(false)
	const latest = useRef(props)
	useLayoutEffect(() => {
		latest.current = props
	}, [props])
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const bound =
		command.mutation.kind === 'status' &&
		command.mutation.status === 'COMPLETED' &&
		task.status === 'COMPLETED' &&
		command.mutation.id === task.id &&
		task.version === command.mutation.expectedVersion + 1 &&
		task.workspaceId === command.workspaceId &&
		command.workspaceId === context.workspace.workspaceId &&
		command.subject === context.session?.userId &&
		command.sessionRevision === context.sessionRevision &&
		scopeKey === context.scopeKey
	const current = () =>
		mounted.current &&
		!opened.current &&
		bound &&
		latest.current.completion === completion &&
		!latest.current.disabled &&
		latest.current.context.canWrite &&
		latest.current.context.scopeKey === scopeKey &&
		latest.current.context.workspace.workspaceId === command.workspaceId &&
		latest.current.context.session?.userId === command.subject &&
		latest.current.context.sessionRevision === command.sessionRevision &&
		latest.current.context.session?.accessToken ===
			context.session?.accessToken &&
		context.current() &&
		latest.current.context.current()
	const open = async () => {
		if (pending.current || disabled || !context.canWrite || !current())
			return
		pending.current = true
		setChecking(true)
		setError(null)
		try {
			const deal = task.dealId
				? await getSalesDeal(
						context.session!.accessToken,
						command.workspaceId,
						task.dealId
					)
				: null
			if (!current()) return
			if (
				deal &&
				(deal.id !== task.dealId ||
					deal.workspaceId !== command.workspaceId ||
					deal.status !== 'OPEN' ||
					deal.archivedAt !== null)
			)
				throw new AuthenticatedApiError(
					'conflict',
					'Связанная сделка уже закрыта или недоступна. Завершение задачи сохранено; следующий шаг не обязателен.'
				)
			// Revalidate write authority after the potentially slow deal lookup and
			// immediately before opening the draft. Create still authorizes again.
			await context.authorize()
			if (!current()) return
			if (latest.current.onCreate(deal) !== false) {
				opened.current = true
				toast('Открыта форма следующей задачи. Укажите название и срок.')
			}
		} catch (cause) {
			if (!current()) return
			const message =
				cause instanceof AuthenticatedApiError
					? cause.message
					: 'Не удалось проверить следующий шаг. Завершение задачи сохранено; попробуйте ещё раз позже.'
			setError(message)
			toast.error(message)
		} finally {
			pending.current = false
			if (mounted.current) setChecking(false)
		}
	}
	if (!bound || !context.canWrite) return null
	return (
		<section className={styles.section} aria-label="Следующий шаг">
			<h3 className={styles.heading}>Задача выполнена. Что дальше?</h3>
			<p className={styles.note}>
				{task.dealId
					? 'При необходимости запланируйте следующий звонок, встречу или другое действие по этой сделке.'
					: 'При необходимости запланируйте следующую задачу.'}{' '}
				Завершение уже сохранено — можно продолжить без нового действия.
			</p>
			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}
			<div className={styles.actions}>
				<Button
					disabled={disabled || checking}
					isLoading={checking}
					onClick={() => void open()}
				>
					Следующая задача
				</Button>
				<Button
					variant="secondary"
					onClick={() => {
						mounted.current = false
						onDismiss()
						toast('Продолжаем без следующей задачи')
					}}
				>
					Не сейчас
				</Button>
			</div>
		</section>
	)
}
