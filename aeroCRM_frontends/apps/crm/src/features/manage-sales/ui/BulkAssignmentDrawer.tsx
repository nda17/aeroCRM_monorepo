'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useWorkdaySession } from '@/entities/crm-workday'
import { AssigneeSelect, useAssigneeOptions } from '@/entities/crm-team'
import {
	applyAssignment,
	previewAssignment,
	type ApplyAssignment,
	type AssignmentPreview,
	type AssignmentResult,
	type AssignmentSelection
} from '@/entities/sales/api/sales-productivity.api'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import { Button, Drawer } from '@/shared/ui'
import styles from './SalesWorkflow.module.scss'

export const BulkAssignmentDrawer = ({
	deals,
	onClose,
	onAssigned
}: {
	deals: AssignmentSelection['deals']
	onClose: () => void
	onAssigned: () => void
}) => {
	const context = useWorkdaySession()
	return (
		<AssignmentForm
			key={JSON.stringify([
				...context.key,
				context.workspace.membership.membershipId
			])}
			context={context}
			deals={deals}
			onClose={onClose}
			onAssigned={onAssigned}
		/>
	)
}

const AssignmentForm = ({
	context,
	deals,
	onClose,
	onAssigned
}: {
	context: ReturnType<typeof useWorkdaySession>
	deals: AssignmentSelection['deals']
	onClose: () => void
	onAssigned: () => void
}) => {
	const client = useQueryClient()
	const [target, setTarget] = useState<
		AssignmentSelection['assignee'] | null
	>(null)
	const actorMembershipId =
		context.permissions.data?.role === 'OWNER'
			? null
			: context.workspace.membership.membershipId
	const actorReady =
		context.permissions.data?.role === 'OWNER' ||
		isUuidV4(actorMembershipId)
	const enabled = context.canWrite && actorReady
	const directory = useAssigneeOptions({
		workspaceId: context.workspace.workspaceId,
		subject: context.session?.userId,
		accessToken: context.session?.accessToken,
		sessionRevision: context.sessionRevision,
		canRead: context.canRead,
		isCurrent: context.current,
		authority: context.permissions.data
	})
	const [preview, setPreview] = useState<{
		signature: string
		value: AssignmentPreview
	} | null>(null)
	const [preparing, setPreparing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const signature = JSON.stringify([
		context.key,
		actorMembershipId,
		deals,
		target
	])
	const frame = useRef({ signature, active: true })
	useEffect(() => {
		frame.current = { signature, active: true }
		return () => {
			frame.current.active = false
		}
	}, [signature])
	const form = useDirtyForm({
		dirty: !!target,
		label: 'Передача выбранных сделок'
	})
	const command = useMemoryCommand<ApplyAssignment, AssignmentResult>(
		{
			owner: commandOwner(
				context.session?.userId,
				context.sessionRevision
			),
			workspaceId: context.workspace.workspaceId,
			view: JSON.stringify([context.scopeKey, actorMembershipId])
		},
		'sales:bulk-assignment',
		enabled,
		context.authorize,
		applyAssignment,
		result => {
			void client.invalidateQueries({ queryKey: ['sales'] })
			void client.invalidateQueries({ queryKey: ['crm-workday'] })
			form.markClean()
			toast.success(
				`Передано сделок: ${result.deals.length}. Задач: ${result.transferredTaskCount}.`
			)
			onAssigned()
		}
	)
	const blocked =
		!!command.error &&
		!command.uncertain &&
		command.error.kind !== 'validation'
	const prepared = preview?.signature === signature ? preview.value : null
	const bound = !!target && !!directory.resolveBinding(target)
	const prepare = async () => {
		if (!enabled || !target || !bound || preparing || command.locked)
			return
		const requestedSignature = signature
		setPreparing(true)
		setError(null)
		setPreview(null)
		try {
			const token = await context.authorize()
			const selection: AssignmentSelection = {
				schemaVersion: 1,
				workspaceId: context.workspace.workspaceId,
				actorMembershipId,
				assignee: target,
				deals
			}
			const result = await previewAssignment(
				token,
				selection,
				context.session!.userId
			)
			if (
				!context.current() ||
				!frame.current.active ||
				frame.current.signature !== requestedSignature
			)
				return
			if (command.snapshot.status === 'rejected' && !command.reset())
				return
			setPreview({ signature: requestedSignature, value: result })
		} catch (caught) {
			if (
				frame.current.active &&
				frame.current.signature === requestedSignature
			)
				setError(
					caught instanceof AuthenticatedApiError
						? caught.message
						: 'Не удалось проверить сделки. Повторите предпросмотр.'
				)
		} finally {
			if (
				frame.current.active &&
				frame.current.signature === requestedSignature
			)
				setPreparing(false)
		}
	}
	const confirm = () => {
		if (
			!enabled ||
			!target ||
			!bound ||
			!prepared ||
			command.locked ||
			blocked
		)
			return
		void command.execute(() => ({
			schemaVersion: 1,
			workspaceId: context.workspace.workspaceId,
			actorMembershipId,
			assignee: { ...target },
			deals: deals.map(row => ({ ...row })),
			previewHash: prepared.previewHash,
			commandId: crypto.randomUUID()
		}))
	}
	const close = () => {
		if (command.locked || preparing) {
			toast('Сначала подтвердите результат текущей операции.')
			return
		}
		form.confirmDiscard(onClose)
	}
	return (
		<Drawer
			isOpen
			title="Передать выбранные сделки"
			description={`Выбрано сделок: ${deals.length}`}
			onClose={close}
			size="lg"
		>
			<div className={styles.form}>
				<p>
					Активные задачи прежнего ответственного перейдут выбранному
					сотруднику. Остальные назначения сохранятся, если сотрудникам
					останется доступ к сделке.
				</p>
				<AssigneeSelect
					options={directory}
					value={target}
					label="Новый ответственный"
					disabled={!enabled || command.locked || preparing}
					onChange={employee => {
						setTarget({
							subject: employee.subject,
							membershipId: employee.membershipId
						})
						setPreview(null)
						setError(null)
					}}
				/>
				{!enabled ? (
					<p role="status">
						Передача доступна после проверки текущих прав.
					</p>
				) : null}
				{error || command.error ? (
					<p role="alert">{error || command.error?.message}</p>
				) : null}
				{command.uncertain ? (
					<>
						<p role="status">
							Результат передачи пока не подтверждён. Проверьте исходную
							команду перед новой операцией.
						</p>
						<Button
							disabled={!enabled || command.running}
							onClick={() => void command.execute()}
						>
							Проверить результат передачи
						</Button>
					</>
				) : (
					<Button
						variant="secondary"
						disabled={!enabled || !bound || preparing || command.locked}
						onClick={() => void prepare()}
					>
						{preparing
							? 'Проверяем сделки…'
							: prepared || blocked
								? 'Повторить предпросмотр'
								: 'Показать изменения'}
					</Button>
				)}
				{prepared && context.canRead ? (
					<section className={styles.section}>
						<h3>Изменения после подтверждения</h3>
						<ul>
							{prepared.deals.map(row => (
								<li key={row.id}>
									<strong>{row.title}</strong>: передать задач —{' '}
									{row.transferredTaskCount}, сохранить назначения —{' '}
									{row.retainedTaskCount}.
								</li>
							))}
						</ul>
						<p>
							Всего задач к передаче: {prepared.transferredTaskCount}.
							Сохранят назначения: {prepared.retainedTaskCount}.
						</p>
						<p className={styles.muted}>
							Все сделки передаются вместе. Если данные или права
							изменились, потребуется новый предпросмотр.
						</p>
						<Button
							disabled={
								!enabled ||
								!bound ||
								command.locked ||
								blocked ||
								preparing
							}
							onClick={confirm}
						>
							Подтвердить передачу {prepared.deals.length} сделок
						</Button>
					</section>
				) : null}
			</div>
		</Drawer>
	)
}
