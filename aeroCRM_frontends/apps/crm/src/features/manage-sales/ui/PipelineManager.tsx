'use client'

import { useDirtyForm, useDirtyFormGuard } from '@/shared/lib/dirty-form'

import {
	listManagedPipelines,
	createManagedPipeline,
	renameManagedPipeline,
	addManagedPipelineStage,
	renameManagedPipelineStage,
	reorderManagedPipelineStages,
	getPipelineNextActionTemplates,
	saveStageNextActionTemplate,
	getPipelineStageDurationSettings,
	saveStageDurationLimit
} from '@/entities/sales/api/commerce.api'
import { getPipelineTemplates } from '@/features/crm-access-gate/api/crm-access.api'
import {
	Button,
	Drawer,
	ScreenState,
	SelectField,
	StatusBadge,
	TextField
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SalesStage } from '@/entities/sales'
import {
	MAX_NEXT_ACTION_DELAY_HOURS,
	type StageNextActionTemplate
} from '@/entities/sales/model/commerce.contract'
import {
	useCommerceCommand,
	type CommerceContext
} from '../model/use-commerce-command'
import { CommerceCommandState } from './CommerceCommandState'
import styles from './Commerce.module.scss'

type PipelineRecord = {
	id: string
	workspaceId: string
	version: number
	name: string
	templateKey: string
	templateVersion: number
	stages: SalesStage[]
}
type PipelineMutation =
	| {
			action: 'create'
			name: string
			templateKey?: string
			templateVersion?: number
	  }
	| { action: 'rename'; id: string; expectedVersion: number; name: string }
	| {
			action: 'addStage'
			id: string
			expectedVersion: number
			name: string
			state: 'OPEN' | 'WON' | 'LOST'
	  }
	| {
			action: 'renameStage'
			id: string
			stageId: string
			expectedVersion: number
			name: string
	  }
	| {
			action: 'reorder'
			id: string
			expectedVersion: number
			stageIds: string[]
	  }
const stageLabels = { OPEN: 'В работе', WON: 'Успешно', LOST: 'Отказ' }
const sameTemplate = (
	left: StageNextActionTemplate | null,
	right: StageNextActionTemplate | null
) =>
	left === right ||
	(!!left &&
		!!right &&
		left.title === right.title &&
		left.delayHours === right.delayHours)

const StageTemplateEditor = ({
	stage,
	template,
	version,
	locked,
	onSave
}: {
	stage: SalesStage
	template: StageNextActionTemplate | null
	version: number
	locked: boolean
	onSave: (
		stageId: string,
		version: number,
		value: StageNextActionTemplate | null
	) => void
}) => {
	const [enabled, setEnabled] = useState(!!template)
	const [title, setTitle] = useState(template?.title ?? '')
	const [delayHours, setDelayHours] = useState(
		String(template?.delayHours ?? 24)
	)
	const [baseline, setBaseline] = useState({ template, version })
	const dirty =
		enabled !== !!baseline.template ||
		(enabled &&
			(title !== baseline.template?.title ||
				delayHours !== String(baseline.template?.delayHours ?? 24)))
	const draftMatchesCurrent =
		enabled === !!template &&
		(!enabled ||
			(title.trim() === template?.title &&
				Number(delayHours) === template?.delayHours))
	if (
		version !== baseline.version ||
		!sameTemplate(template, baseline.template)
	) {
		if (
			!dirty ||
			sameTemplate(template, baseline.template) ||
			draftMatchesCurrent
		)
			setBaseline({ template, version })
		if (!dirty) {
			setEnabled(!!template)
			setTitle(template?.title ?? '')
			setDelayHours(String(template?.delayHours ?? 24))
		}
	}
	const conflict =
		version !== baseline.version ||
		!sameTemplate(template, baseline.template)
	useDirtyForm({ dirty, label: `Шаблон этапа «${stage.name}»` })
	return (
		<form
			className={styles.item}
			onSubmit={event => {
				event.preventDefault()
				if (!locked && !conflict && dirty)
					onSave(
						stage.id,
						baseline.version,
						enabled
							? {
									title: title.trim(),
									delayHours: Number(delayHours)
								}
							: null
					)
			}}
		>
			<div className={styles.heading}>
				<strong>{stage.name}</strong>
				<span className={styles.muted}>
					{template ? 'Шаблон включён' : 'Без шаблона'}
				</span>
			</div>
			<label className={styles.check}>
				<input
					type="checkbox"
					checked={enabled}
					disabled={locked}
					onChange={event => setEnabled(event.target.checked)}
				/>
				Предлагать следующее действие при переходе на этот этап
			</label>
			{enabled ? (
				<div className={styles.grid}>
					<TextField
						label="Название следующего действия"
						value={title}
						required
						maxLength={200}
						disabled={locked}
						onChange={event => setTitle(event.target.value)}
					/>
					<TextField
						label="Срок через, часов"
						type="number"
						value={delayHours}
						required
						min={1}
						max={MAX_NEXT_ACTION_DELAY_HOURS}
						step={1}
						disabled={locked}
						onChange={event => setDelayHours(event.target.value)}
					/>
				</div>
			) : null}
			{conflict ? (
				<div className={styles.notice}>
					<p>
						Шаблон этапа изменился. Ваш черновик сохранён на экране.
						Актуальное значение:{' '}
						{template
							? `«${template.title}», через ${template.delayHours} ч`
							: 'без шаблона'}
						.
					</p>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={locked}
						onClick={() => setBaseline({ template, version })}
					>
						Применить мой черновик к актуальной версии
					</Button>
				</div>
			) : null}
			<div className={styles.actions}>
				<Button
					type="submit"
					size="sm"
					variant="secondary"
					disabled={locked || conflict || !dirty}
				>
					Сохранить шаблон
				</Button>
			</div>
		</form>
	)
}

const StageDurationEditor = ({
	stage,
	limitDays,
	version,
	locked,
	onSave
}: {
	stage: SalesStage
	limitDays: number | null
	version: number
	locked: boolean
	onSave: (
		stageId: string,
		version: number,
		limitDays: number | null
	) => void
}) => {
	const [enabled, setEnabled] = useState(limitDays !== null)
	const [days, setDays] = useState(String(limitDays ?? 3))
	const [baseline, setBaseline] = useState({ limitDays, version })
	const dirty =
		enabled !== (baseline.limitDays !== null) ||
		(enabled && days !== String(baseline.limitDays ?? 3))
	const matchesCurrent =
		enabled === (limitDays !== null) &&
		(!enabled || Number(days) === limitDays)
	if (version !== baseline.version || limitDays !== baseline.limitDays) {
		if (!dirty || limitDays === baseline.limitDays || matchesCurrent)
			setBaseline({ limitDays, version })
		if (!dirty) {
			setEnabled(limitDays !== null)
			setDays(String(limitDays ?? 3))
		}
	}
	const conflict =
		version !== baseline.version || limitDays !== baseline.limitDays
	const valid =
		!enabled ||
		(Number.isSafeInteger(Number(days)) &&
			Number(days) >= 1 &&
			Number(days) <= 3650)
	useDirtyForm({ dirty, label: `Срок этапа «${stage.name}»` })
	return (
		<form
			className={styles.item}
			onSubmit={event => {
				event.preventDefault()
				if (!locked && !conflict && dirty && valid)
					onSave(stage.id, baseline.version, enabled ? Number(days) : null)
			}}
		>
			<div className={styles.heading}>
				<strong>{stage.name}</strong>
				<span className={styles.muted}>
					{limitDays === null
						? 'Без ограничения'
						: `Срок: ${limitDays} дн.`}
				</span>
			</div>
			<label className={styles.check}>
				<input
					type="checkbox"
					aria-label={`Ограничить время на этапе «${stage.name}»`}
					checked={enabled}
					disabled={locked}
					onChange={event => setEnabled(event.target.checked)}
				/>{' '}
				Ограничить время на этапе
			</label>
			{enabled ? (
				<TextField
					label={`Срок этапа «${stage.name}», дней`}
					type="number"
					value={days}
					required
					min={1}
					max={3650}
					step={1}
					disabled={locked}
					onChange={event => setDays(event.target.value)}
				/>
			) : null}
			{conflict ? (
				<div className={styles.notice}>
					<p>
						Срок этапа изменился. Ваш черновик сохранён на экране.
						Актуальное значение:{' '}
						{limitDays === null ? 'без ограничения' : `${limitDays} дн.`}.
					</p>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={locked}
						onClick={() => setBaseline({ limitDays, version })}
					>
						Применить мой черновик к актуальной версии
					</Button>
				</div>
			) : null}
			<div className={styles.actions}>
				<Button
					type="submit"
					size="sm"
					variant="secondary"
					disabled={locked || conflict || !dirty || !valid}
				>
					Сохранить срок этапа
				</Button>
			</div>
		</form>
	)
}

const StageNameEditor = ({
	stage,
	disabled,
	onSave
}: {
	stage: SalesStage
	disabled: boolean
	onSave: (name: string) => void
}) => {
	const [name, setName] = useState(stage.name)
	useDirtyForm({ dirty: name !== stage.name, label: 'Название этапа' })
	return (
		<form
			className={styles.actions}
			onSubmit={event => {
				event.preventDefault()
				if (!disabled && name.trim()) onSave(name.trim())
			}}
		>
			<TextField
				label={`Название этапа «${stage.name}»`}
				value={name}
				maxLength={200}
				required
				disabled={disabled}
				onChange={event => setName(event.target.value)}
			/>
			<Button
				type="submit"
				size="sm"
				variant="secondary"
				disabled={disabled || name.trim() === stage.name}
			>
				Переименовать этап
			</Button>
		</form>
	)
}

const pipelineStructure = (pipeline: PipelineRecord) =>
	JSON.stringify({
		name: pipeline.name,
		stages: pipeline.stages.map(stage => ({
			id: stage.id,
			name: stage.name,
			state: stage.state
		}))
	})

const PipelineEditor = ({
	pipeline,
	locked,
	execute,
	onRefresh
}: {
	pipeline: PipelineRecord
	locked: boolean
	execute: (mutation: PipelineMutation) => Promise<void>
	onRefresh: () => void
}) => {
	const [baseline] = useState(() => ({
		version: pipeline.version,
		structure: pipelineStructure(pipeline)
	}))
	const structuralConflict =
		baseline.structure !== pipelineStructure(pipeline)
	// Duration limits and next-action templates share Pipeline.version. Accept
	// those revisions without remounting the structural editor or losing drafts.
	const draftVersion = structuralConflict
		? baseline.version
		: pipeline.version
	const editorLocked = locked || structuralConflict
	const [name, setName] = useState(pipeline.name)
	const [newName, setNewName] = useState('')
	const [newState, setNewState] = useState<'OPEN' | 'WON' | 'LOST'>('OPEN')
	const [order, setOrder] = useState(
		pipeline.stages.map(stage => stage.id)
	)
	const changed = order.some(
		(id, index) => pipeline.stages[index]?.id !== id
	)
	useDirtyForm({
		dirty:
			name !== pipeline.name ||
			!!newName ||
			newState !== 'OPEN' ||
			changed,
		label: 'Воронка и этапы'
	})
	const move = (index: number, offset: number) => {
		setOrder(current => {
			const next = [...current]
			;[next[index], next[index + offset]] = [
				next[index + offset],
				next[index]
			]
			return next
		})
	}
	return (
		<div className={styles.stack}>
			{structuralConflict ? (
				<div className={styles.notice}>
					<p>
						Версия воронки изменилась. Ваши черновики сохранены на экране.
						Обновите редактор перед новым изменением воронки.
					</p>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						onClick={onRefresh}
					>
						Обновить редактор
					</Button>
				</div>
			) : null}
			<form
				className={styles.grid}
				onSubmit={event => {
					event.preventDefault()
					if (!editorLocked)
						void execute({
							action: 'rename',
							id: pipeline.id,
							expectedVersion: draftVersion,
							name: name.trim()
						})
				}}
			>
				<TextField
					label="Название воронки"
					value={name}
					required
					maxLength={200}
					disabled={editorLocked}
					onChange={event => setName(event.target.value)}
				/>
				<div className={styles.actions}>
					<Button
						type="submit"
						variant="secondary"
						disabled={editorLocked || name.trim() === pipeline.name}
					>
						Переименовать воронку
					</Button>
				</div>
			</form>
			<p className={styles.muted}>
				Изменения названий и порядка сохраняют сделки на их этапах. Тип
				существующего этапа не меняется, удаление этапов не предусмотрено.
			</p>
			<ol className={styles.stack} aria-label="Порядок этапов">
				{order.map((id, index) => {
					const stage = pipeline.stages.find(item => item.id === id)!
					return (
						<li key={id} className={styles.item}>
							<div className={styles.heading}>
								<strong>
									{index + 1}. {stage.name}
								</strong>
								<StatusBadge
									tone={
										stage.state === 'WON'
											? 'success'
											: stage.state === 'LOST'
												? 'neutral'
												: 'info'
									}
								>
									{stageLabels[stage.state]}
								</StatusBadge>
							</div>
							<StageNameEditor
								stage={stage}
								disabled={editorLocked || changed}
								onSave={value =>
									void execute({
										action: 'renameStage',
										id: pipeline.id,
										stageId: id,
										expectedVersion: draftVersion,
										name: value
									})
								}
							/>
							<div className={styles.actions}>
								<Button
									size="sm"
									variant="ghost"
									disabled={editorLocked || index === 0}
									onClick={() => move(index, -1)}
									aria-label={`Поднять этап «${stage.name}»`}
								>
									↑ Выше
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={editorLocked || index === order.length - 1}
									onClick={() => move(index, 1)}
									aria-label={`Опустить этап «${stage.name}»`}
								>
									↓ Ниже
								</Button>
							</div>
						</li>
					)
				})}
			</ol>
			{changed && (
				<div className={styles.actions}>
					<Button
						disabled={editorLocked}
						onClick={() =>
							void execute({
								action: 'reorder',
								id: pipeline.id,
								expectedVersion: draftVersion,
								stageIds: order
							})
						}
					>
						Сохранить порядок этапов
					</Button>
					<Button
						variant="ghost"
						disabled={editorLocked}
						onClick={() =>
							setOrder(pipeline.stages.map(stage => stage.id))
						}
					>
						Отменить перестановку
					</Button>
				</div>
			)}
			<form
				className={styles.section}
				onSubmit={event => {
					event.preventDefault()
					if (!editorLocked && !changed)
						void execute({
							action: 'addStage',
							id: pipeline.id,
							expectedVersion: draftVersion,
							name: newName.trim(),
							state: newState
						})
				}}
			>
				<h3>Добавить этап</h3>
				<fieldset
					className={styles.fields}
					disabled={
						editorLocked || changed || pipeline.stages.length >= 100
					}
				>
					<TextField
						label="Название нового этапа"
						value={newName}
						required
						maxLength={200}
						onChange={event => setNewName(event.target.value)}
					/>
					<SelectField
						label="Тип нового этапа"
						value={newState}
						onChange={event =>
							setNewState(event.target.value as 'OPEN' | 'WON' | 'LOST')
						}
					>
						<option value="OPEN">В работе</option>
						<option value="WON">Успешно</option>
						<option value="LOST">Отказ</option>
					</SelectField>
					<Button type="submit" variant="secondary">
						Добавить этап
					</Button>
				</fieldset>
			</form>
		</div>
	)
}

export const PipelineManager = ({
	context,
	onClose,
	onSaved
}: {
	context: CommerceContext
	onClose: () => void
	onSaved: () => void
}) => {
	const draftGuard = useDirtyFormGuard()
	const queryClient = useQueryClient()
	const [selectedId, setSelectedId] = useState('')
	const [creating, setCreating] = useState(false)
	const [name, setName] = useState('')
	const [template, setTemplate] = useState('')
	const newPipelineDraft = useDirtyForm({
		dirty: creating && (!!name || !!template),
		label: 'Новая воронка'
	})
	const [revision, setRevision] = useState(0)
	const pipelines = useQuery({
		queryKey: ['sales', 'managed-pipelines', ...context.key],
		enabled: context.canRead,
		queryFn: () =>
			listManagedPipelines(
				context.session!.accessToken,
				context.workspace.workspaceId
			),
		retry: false,
		gcTime: 0
	})
	const templates = useQuery({
		queryKey: ['sales', 'pipeline-templates', ...context.key],
		enabled: context.canRead,
		queryFn: () => getPipelineTemplates(context.session!.accessToken),
		retry: false,
		gcTime: 0
	})
	const pipeline =
		pipelines.data?.items.find(item => item.id === selectedId) ||
		pipelines.data?.items[0]
	const stageTemplates = useQuery({
		queryKey: [
			'sales',
			'next-action-templates',
			...context.key,
			pipeline?.id
		],
		enabled: context.canRead && !!context.session && !!pipeline,
		queryFn: () =>
			getPipelineNextActionTemplates(
				context.session!.accessToken,
				context.workspace.workspaceId,
				pipeline!.id
			),
		retry: false,
		gcTime: 0
	})
	const stageDuration = useQuery({
		queryKey: [
			'sales',
			'stage-duration-settings',
			...context.key,
			pipeline?.id
		],
		enabled: context.canRead && !!context.session && !!pipeline,
		queryFn: () =>
			getPipelineStageDurationSettings(
				context.session!.accessToken,
				context.workspace.workspaceId,
				pipeline!.id
			),
		retry: false,
		gcTime: 0
	})
	const command = useCommerceCommand<PipelineMutation, unknown>(
		context,
		'pipelines',
		(token, input) => {
			const base = {
				schemaVersion: 1 as const,
				workspaceId: input.workspaceId,
				commandId: input.commandId
			}
			if (input.action === 'create')
				return createManagedPipeline(token, {
					...base,
					name: input.name,
					...(input.templateKey
						? {
								templateKey: input.templateKey,
								templateVersion: input.templateVersion
							}
						: {})
				})
			const versioned = { ...base, expectedVersion: input.expectedVersion }
			switch (input.action) {
				case 'rename':
					return renameManagedPipeline(token, input.id, {
						...versioned,
						name: input.name
					})
				case 'addStage':
					return addManagedPipelineStage(token, input.id, {
						...versioned,
						name: input.name,
						state: input.state
					})
				case 'renameStage':
					return renameManagedPipelineStage(
						token,
						input.id,
						input.stageId,
						{ ...versioned, name: input.name }
					)
				case 'reorder':
					return reorderManagedPipelineStages(token, input.id, {
						...versioned,
						stageIds: input.stageIds
					})
			}
		},
		() => {
			setCreating(false)
			setName('')
			onSaved()
			void pipelines.refetch().then(result => {
				if (!result.isError) setRevision(value => value + 1)
			})
			void stageTemplates.refetch()
			void stageDuration.refetch()
		},
		'sales:manage-pipelines'
	)
	const templateCommand = useCommerceCommand<
		{
			stageId: string
			pipelineId: string
			expectedVersion: number
			template: StageNextActionTemplate | null
		},
		Awaited<ReturnType<typeof saveStageNextActionTemplate>>
	>(
		context,
		'pipeline-next-action-template',
		(token, input) =>
			saveStageNextActionTemplate(
				token,
				input.workspaceId,
				input.pipelineId,
				input.stageId,
				input
			),
		result => {
			queryClient.setQueryData(
				[
					'sales',
					'next-action-templates',
					...context.key,
					result.pipelineId
				],
				result
			)
			onSaved()
			void stageDuration.refetch()
			void pipelines.refetch()
		},
		'sales:manage-pipelines'
	)
	const durationCommand = useCommerceCommand<
		{
			stageId: string
			pipelineId: string
			expectedVersion: number
			limitDays: number | null
		},
		Awaited<ReturnType<typeof saveStageDurationLimit>>
	>(
		context,
		'pipeline-stage-duration',
		(token, input) =>
			saveStageDurationLimit(
				token,
				input.workspaceId,
				input.pipelineId,
				input.stageId,
				input
			),
		result => {
			queryClient.setQueryData(
				[
					'sales',
					'stage-duration-settings',
					...context.key,
					result.pipelineId
				],
				result
			)
			onSaved()
			void pipelines.refetch()
			void stageTemplates.refetch()
		},
		'sales:manage-pipelines'
	)
	const refreshDuration = async () => {
		const results = await Promise.all([
			context.permissions.refetch(),
			pipelines.refetch(),
			stageDuration.refetch(),
			stageTemplates.refetch()
		])
		if (results.some(result => result.isError)) throw new Error()
	}
	const refresh = async () => {
		const [access, result] = await Promise.all([
			context.permissions.refetch(),
			pipelines.refetch()
		])
		if (access.isError || result.isError) throw new Error()
		setRevision(value => value + 1)
		void stageDuration.refetch()
		void stageTemplates.refetch()
	}
	const refreshTemplate = async () => {
		const [access, currentPipeline, currentTemplates] = await Promise.all([
			context.permissions.refetch(),
			pipelines.refetch(),
			stageTemplates.refetch()
		])
		if (
			access.isError ||
			currentPipeline.isError ||
			currentTemplates.isError
		)
			throw new Error()
	}
	if (!context.canRead)
		return (
			<Drawer
				dirtyFormIds={[newPipelineDraft.id]}
				isOpen
				title="Управление воронками"
				onClose={() => {
					if (
						command.canClose() &&
						templateCommand.canClose() &&
						durationCommand.canClose()
					)
						onClose()
				}}
			>
				<ScreenState
					variant={
						context.permissions.isFetching ? 'loading' : 'permission'
					}
				/>
			</Drawer>
		)
	return (
		<Drawer
			isOpen
			title="Управление воронками"
			size="lg"
			onClose={() => {
				if (
					command.canClose() &&
					templateCommand.canClose() &&
					durationCommand.canClose()
				)
					onClose()
			}}
			description="Одной универсальной воронки достаточно для товаров и услуг. Дополнительная нужна, если отличаются этапы работы."
		>
			<div className={styles.stack}>
				<CommerceCommandState
					command={durationCommand}
					onReview={refreshDuration}
				/>
				<CommerceCommandState command={command} onReview={refresh} />
				<CommerceCommandState
					command={templateCommand}
					onReview={refreshTemplate}
				/>
				{pipelines.isError && pipelines.data ? (
					<ScreenState
						compact
						variant="error"
						description="Не удалось обновить воронки. Введённые изменения сохранены."
						action={
							<Button onClick={() => void pipelines.refetch()}>
								Повторить
							</Button>
						}
					/>
				) : null}
				{pipelines.isError && !pipelines.data ? (
					<ScreenState
						variant="error"
						action={
							<Button onClick={() => void pipelines.refetch()}>
								Повторить
							</Button>
						}
					/>
				) : !pipelines.data ? (
					<ScreenState variant="loading" />
				) : (
					<>
						<div className={styles.grid}>
							<SelectField
								label="Воронка"
								value={pipeline?.id || ''}
								disabled={
									command.locked ||
									templateCommand.locked ||
									durationCommand.locked
								}
								onChange={event => {
									const id = event.target.value
									draftGuard.confirmDiscard(() => {
										setSelectedId(id)
										setCreating(false)
									})
								}}
							>
								{pipelines.data.items.map(item => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
							</SelectField>
							<div className={styles.actions}>
								<Button
									variant="secondary"
									disabled={
										command.locked ||
										templateCommand.locked ||
										durationCommand.locked
									}
									onClick={() =>
										draftGuard.confirmDiscard(() =>
											setCreating(value => !value)
										)
									}
								>
									{creating
										? 'К существующей воронке'
										: 'Добавить воронку'}
								</Button>
							</div>
						</div>
						{creating ? (
							<form
								className={styles.section}
								onSubmit={event => {
									event.preventDefault()
									const selected = templates.data?.templates.find(
										item => `${item.key}:${item.version}` === template
									)
									if (!command.locked)
										void command.execute({
											action: 'create',
											name: name.trim(),
											...(selected
												? {
														templateKey: selected.key,
														templateVersion: selected.version
													}
												: {})
										})
								}}
							>
								<h3>Новая воронка</h3>
								<fieldset
									className={styles.fields}
									disabled={command.locked}
								>
									<TextField
										label="Название новой воронки"
										value={name}
										required
										maxLength={200}
										onChange={event => setName(event.target.value)}
									/>
									<SelectField
										label="Начальные этапы"
										value={template}
										onChange={event => setTemplate(event.target.value)}
									>
										<option value="">Пустая воронка</option>
										{templates.data?.templates.map(item => (
											<option
												key={`${item.key}:${item.version}`}
												value={`${item.key}:${item.version}`}
											>
												{item.name}
											</option>
										))}
									</SelectField>
									{!template && (
										<p className={styles.muted}>
											Будут созданы этапы «Новая сделка», «Успешно» и «Не
											реализовано». Затем можно добавить свои этапы.
										</p>
									)}
									{templates.isError && (
										<p className={styles.muted}>
											Шаблоны временно недоступны. Можно создать пустую
											воронку.
										</p>
									)}
									<Button type="submit" isLoading={command.running}>
										Создать воронку
									</Button>
								</fieldset>
							</form>
						) : (
							pipeline && (
								<>
									<PipelineEditor
										key={`${pipeline.id}:${revision}`}
										pipeline={pipeline}
										locked={
											command.locked ||
											templateCommand.locked ||
											durationCommand.locked ||
											pipelines.isFetching
										}
										execute={command.execute}
										onRefresh={() =>
											draftGuard.confirmDiscard(() =>
												setRevision(value => value + 1)
											)
										}
									/>
									<section className={styles.section}>
										<h3>Контроль срока этапа</h3>
										<p className={styles.muted}>
											День = 24 часа, выходные учитываются. Срок считается
											от последнего входа сделки на этап. Изменение
											настройки сразу влияет на текущие сделки. Уведомления
											и автоматические действия не создаются.
										</p>
										{stageDuration.isError ? (
											<ScreenState
												compact
												variant="error"
												description="Не удалось обновить сроки этапов. Черновики сохранены."
												action={
													<Button
														variant="secondary"
														onClick={() =>
															void refreshDuration().catch(() => undefined)
														}
													>
														Повторить
													</Button>
												}
											/>
										) : null}
										{!stageDuration.data && !stageDuration.isError ? (
											<ScreenState compact variant="loading" />
										) : stageDuration.data ? (
											pipeline.stages
												.filter(stage => stage.state === 'OPEN')
												.map(stage => (
													<StageDurationEditor
														key={`${pipeline.id}:${stage.id}`}
														stage={stage}
														limitDays={
															stageDuration.data.items.find(
																item => item.stageId === stage.id
															)?.limitDays ?? null
														}
														version={stageDuration.data.pipelineVersion}
														locked={
															command.locked ||
															templateCommand.locked ||
															durationCommand.locked ||
															stageDuration.isFetching ||
															stageDuration.isError ||
															pipelines.isFetching
														}
														onSave={(
															stageId,
															expectedVersion,
															limitDays
														) =>
															void durationCommand.execute({
																pipelineId: pipeline.id,
																stageId,
																expectedVersion,
																limitDays
															})
														}
													/>
												))
										) : null}
									</section>
									<section className={styles.section}>
										<h3>Следующее действие по этапу</h3>
										<p className={styles.muted}>
											При выборе этапа шаблон предложит название и срок
											следующей задачи. Сотрудник сможет изменить их до
											сохранения перехода. 24 часа равны одному дню.
											Изменения шаблона не затрагивают созданные задачи.
										</p>
										{stageTemplates.isError && stageTemplates.data ? (
											<div className={styles.notice}>
												<p>
													Не удалось обновить шаблоны этапов. Черновики
													сохранены; перед следующим изменением проверьте
													актуальные данные.
												</p>
												<Button
													type="button"
													variant="secondary"
													size="sm"
													onClick={() => void stageTemplates.refetch()}
												>
													Повторить
												</Button>
											</div>
										) : null}
										{stageTemplates.isError && !stageTemplates.data ? (
											<ScreenState
												compact
												variant="error"
												description="Не удалось загрузить шаблоны этапов."
												action={
													<Button
														variant="secondary"
														onClick={() => void stageTemplates.refetch()}
													>
														Повторить
													</Button>
												}
											/>
										) : stageTemplates.isPending ||
										  !stageTemplates.data ? (
											<ScreenState compact variant="loading" />
										) : (
											pipeline.stages
												.filter(stage => stage.state === 'OPEN')
												.map(stage => (
													<StageTemplateEditor
														key={`${pipeline.id}:${stage.id}`}
														stage={stage}
														template={
															stageTemplates.data.items.find(
																item => item.stageId === stage.id
															)?.template ?? null
														}
														version={stageTemplates.data.pipelineVersion}
														locked={
															command.locked ||
															templateCommand.locked ||
															durationCommand.locked ||
															stageTemplates.isFetching ||
															stageTemplates.isError
														}
														onSave={(stageId, expectedVersion, value) =>
															void templateCommand.execute({
																pipelineId: pipeline.id,
																stageId,
																expectedVersion,
																template: value
															})
														}
													/>
												))
										)}
									</section>
								</>
							)
						)}
					</>
				)}
			</div>
		</Drawer>
	)
}
