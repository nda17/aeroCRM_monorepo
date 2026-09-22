'use client'

import {
	listManagedPipelines,
	createManagedPipeline,
	renameManagedPipeline,
	addManagedPipelineStage,
	renameManagedPipelineStage,
	reorderManagedPipelineStages
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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { SalesStage } from '@/entities/sales'
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

const PipelineEditor = ({
	pipeline,
	locked,
	execute
}: {
	pipeline: PipelineRecord
	locked: boolean
	execute: (mutation: PipelineMutation) => Promise<void>
}) => {
	const [name, setName] = useState(pipeline.name)
	const [newName, setNewName] = useState('')
	const [newState, setNewState] = useState<'OPEN' | 'WON' | 'LOST'>('OPEN')
	const [order, setOrder] = useState(
		pipeline.stages.map(stage => stage.id)
	)
	const changed = order.some(
		(id, index) => pipeline.stages[index]?.id !== id
	)
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
			<form
				className={styles.grid}
				onSubmit={event => {
					event.preventDefault()
					if (!locked)
						void execute({
							action: 'rename',
							id: pipeline.id,
							expectedVersion: pipeline.version,
							name: name.trim()
						})
				}}
			>
				<TextField
					label="Название воронки"
					value={name}
					required
					maxLength={200}
					disabled={locked}
					onChange={event => setName(event.target.value)}
				/>
				<div className={styles.actions}>
					<Button
						type="submit"
						variant="secondary"
						disabled={locked || name.trim() === pipeline.name}
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
								disabled={locked || changed}
								onSave={value =>
									void execute({
										action: 'renameStage',
										id: pipeline.id,
										stageId: id,
										expectedVersion: pipeline.version,
										name: value
									})
								}
							/>
							<div className={styles.actions}>
								<Button
									size="sm"
									variant="ghost"
									disabled={locked || index === 0}
									onClick={() => move(index, -1)}
									aria-label={`Поднять этап «${stage.name}»`}
								>
									↑ Выше
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={locked || index === order.length - 1}
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
						disabled={locked}
						onClick={() =>
							void execute({
								action: 'reorder',
								id: pipeline.id,
								expectedVersion: pipeline.version,
								stageIds: order
							})
						}
					>
						Сохранить порядок этапов
					</Button>
					<Button
						variant="ghost"
						disabled={locked}
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
					if (!locked && !changed)
						void execute({
							action: 'addStage',
							id: pipeline.id,
							expectedVersion: pipeline.version,
							name: newName.trim(),
							state: newState
						})
				}}
			>
				<h3>Добавить этап</h3>
				<fieldset
					className={styles.fields}
					disabled={locked || changed || pipeline.stages.length >= 100}
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
	const [selectedId, setSelectedId] = useState('')
	const [creating, setCreating] = useState(false)
	const [name, setName] = useState('')
	const [template, setTemplate] = useState('')
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
			setRevision(value => value + 1)
			setCreating(false)
			setName('')
			onSaved()
			void pipelines.refetch()
		},
		'sales:manage-pipelines'
	)
	const pipeline =
		pipelines.data?.items.find(item => item.id === selectedId) ||
		pipelines.data?.items[0]
	const refresh = async () => {
		const [access, result] = await Promise.all([
			context.permissions.refetch(),
			pipelines.refetch()
		])
		if (access.isError || result.isError) throw new Error()
		setRevision(value => value + 1)
	}
	if (!context.canRead)
		return (
			<Drawer
				isOpen
				title="Управление воронками"
				onClose={() => {
					if (command.canClose()) onClose()
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
				if (command.canClose()) onClose()
			}}
			description="Одной универсальной воронки достаточно для товаров и услуг. Дополнительная нужна, если отличаются этапы работы."
		>
			<div className={styles.stack}>
				<CommerceCommandState command={command} onReview={refresh} />
				{pipelines.isError ? (
					<ScreenState
						variant="error"
						action={
							<Button onClick={() => void pipelines.refetch()}>
								Повторить
							</Button>
						}
					/>
				) : pipelines.isPending ? (
					<ScreenState variant="loading" />
				) : (
					<>
						<div className={styles.grid}>
							<SelectField
								label="Воронка"
								value={pipeline?.id || ''}
								disabled={command.locked}
								onChange={event => {
									setSelectedId(event.target.value)
									setCreating(false)
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
									disabled={command.locked}
									onClick={() => setCreating(value => !value)}
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
								<PipelineEditor
									key={`${pipeline.id}:${pipeline.version}:${revision}`}
									pipeline={pipeline}
									locked={command.locked || pipelines.isFetching}
									execute={command.execute}
								/>
							)
						)}
					</>
				)}
			</div>
		</Drawer>
	)
}
