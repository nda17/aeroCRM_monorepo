'use client'

import { listCustomers, type Customer } from '@/entities/customer'
import { CustomerEditor } from '@/features/edit-customer'
import type { SalesPipeline } from '@/entities/sales'
import {
	Button,
	Drawer,
	ScreenState,
	SelectField,
	TextField
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useSalesCommand } from '../model/use-sales-command'
import { useSalesSession } from '../model/use-sales-session'
import { SalesCommandState } from './SalesCommandState'
import { NextActionFields } from './NextActionFields'
import styles from './SalesWorkflow.module.scss'

export const parseRublesToMinor = (value: string) => {
	if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(value.trim())) return null
	const [whole, fraction = ''] = value.trim().replace(',', '.').split('.')
	const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
	return amount <= 2147483647n ? Number(amount) : null
}

export const CreateDealDrawer = ({
	pipelines,
	onClose,
	onSaved
}: {
	pipelines: SalesPipeline[]
	onClose: () => void
	onSaved: () => void
}) => {
	const context = useSalesSession()
	const client = useQueryClient()
	const [creatingContact, setCreatingContact] = useState(false)
	const [pipelineId, setPipelineId] = useState(pipelines[0]?.id || '')
	const pipeline = pipelines.find(item => item.id === pipelineId)
	const [stageId, setStageId] = useState(
		pipeline?.stages.find(stage => stage.state === 'OPEN')?.id || ''
	)
	const [title, setTitle] = useState('')
	const [amount, setAmount] = useState('0')
	const [taskTitle, setTaskTitle] = useState('Связаться с клиентом')
	const [due, setDue] = useState('')
	const [search, setSearch] = useState('')
	const [searchInput, setSearchInput] = useState('')
	const [page, setPage] = useState(1)
	const [selected, setSelected] = useState<Customer | null>(null)
	useEffect(() => {
		const timer = window.setTimeout(() => {
			setSearch(searchInput.trim())
			setPage(1)
		}, 300)
		return () => window.clearTimeout(timer)
	}, [searchInput])
	const canCreateContacts =
		context.canWrite &&
		context.permissions.data?.permissions.includes('customers:write') ===
			true
	const canReadContacts =
		context.canRead &&
		context.permissions.data?.permissions.includes('customers:read') ===
			true
	const contacts = useQuery({
		queryKey: [
			'crm-customers',
			context.workspace.workspaceId,
			'sales-picker',
			...context.key,
			page,
			search
		],
		enabled: canReadContacts && !!context.session,
		queryFn: () =>
			listCustomers(
				context.session!.accessToken,
				'contacts',
				context.workspace.workspaceId,
				page,
				10,
				search
			),
		retry: false,
		gcTime: 0
	})
	const ready =
		context.canWrite &&
		canReadContacts &&
		!contacts.isError &&
		!contacts.isFetching &&
		!!contacts.data
	const command = useSalesCommand(
		context.workspace.workspaceId,
		context.session?.accessToken || '',
		context.canWrite,
		() => {
			onSaved()
			onClose()
		},
		'deal:new',
		context.scopeKey
	)
	const options = contacts.data?.items || []
	const choosePipeline = (id: string) => {
		setPipelineId(id)
		setStageId(
			pipelines
				.find(item => item.id === id)
				?.stages.find(stage => stage.state === 'OPEN')?.id || ''
		)
	}
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!ready || command.locked) return
		const amountMinor = parseRublesToMinor(amount)
		if (
			amountMinor === null ||
			!selected ||
			!pipelineId ||
			!stageId ||
			!Number.isFinite(Date.parse(due))
		) {
			toast.error('Выберите контакт, этап, дату и корректную сумму')
			return
		}
		void command.execute({
			kind: 'create',
			title: title.trim(),
			currency: 'RUB',
			amountMinor,
			pipelineId,
			stageId,
			contactId: selected.id,
			nextTask: {
				title: taskTitle.trim(),
				dueAt: new Date(due).toISOString()
			}
		})
	}
	const review = async () => {
		const [auth, data] = await Promise.all([
			context.permissions.refetch(),
			contacts.refetch()
		])
		if (auth.isError || data.isError)
			throw new Error('Не удалось проверить контакты и права')
		command.resetAfterReview()
	}
	return (
		<>
			<Drawer
				isOpen={!creatingContact}
				onClose={() => {
					if (command.canClose()) onClose()
				}}
				title="Новая сделка"
				description="Выберите клиента и запланируйте первое действие. Вы будете ответственным за сделку."
				footer={
					<Button
						type="submit"
						form="create-sales-deal"
						disabled={!ready || command.locked || !selected}
						isLoading={command.pending}
					>
						Создать сделку
					</Button>
				}
			>
				<form
					id="create-sales-deal"
					className={styles.form}
					onSubmit={submit}
				>
					<SalesCommandState command={command} onReview={review} />
					<fieldset className={styles.fields} disabled={command.locked}>
						<TextField
							label="Название сделки"
							required
							maxLength={200}
							value={title}
							onChange={event => setTitle(event.target.value)}
						/>
						<div className={styles.formGrid}>
							<SelectField
								label="Воронка"
								value={pipelineId}
								onChange={event => choosePipeline(event.target.value)}
							>
								{pipelines.map(item => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
							</SelectField>
							<SelectField
								label="Этап"
								value={stageId}
								onChange={event => setStageId(event.target.value)}
							>
								{pipeline?.stages
									.filter(stage => stage.state === 'OPEN')
									.map(stage => (
										<option key={stage.id} value={stage.id}>
											{stage.name}
										</option>
									))}
							</SelectField>
						</div>
						<TextField
							label="Сумма, ₽"
							inputMode="decimal"
							required
							value={amount}
							onChange={event => setAmount(event.target.value)}
						/>
					</fieldset>
					<section className={styles.section} aria-label="Выбор контакта">
						<h3>Контакт</h3>
						{!canReadContacts ? (
							<ScreenState
								variant="permission"
								compact
								description="Нет доступа к контактам для создания сделки."
							/>
						) : (
							<>
								{selected ? (
									<>
										<div className={styles.actions}>
											<strong>{selected.name}</strong>
											<Button
												size="sm"
												variant="ghost"
												disabled={command.locked}
												onClick={() => setSelected(null)}
											>
												Выбрать другого
											</Button>
										</div>
										{contacts.isError ? (
											<ScreenState
												variant="error"
												compact
												description="Не удалось обновить контакты. Выбранный клиент и поля сделки сохранены. Повторите проверку, чтобы создать сделку."
												action={
													<Button
														variant="secondary"
														disabled={
															command.locked || contacts.isFetching
														}
														onClick={() => {
															void contacts.refetch()
															toast('Повторно проверяем контакты')
														}}
													>
														Повторить
													</Button>
												}
											/>
										) : null}
									</>
								) : (
									<>
										<TextField
											label="Поиск контакта"
											maxLength={200}
											placeholder="Имя, телефон или email"
											value={searchInput}
											disabled={command.locked}
											onChange={event =>
												setSearchInput(event.target.value)
											}
										/>
										{contacts.isError ? (
											<ScreenState
												variant="error"
												compact
												action={
													<Button
														variant="secondary"
														onClick={() => void contacts.refetch()}
													>
														Повторить
													</Button>
												}
											/>
										) : contacts.isFetching ? (
											<ScreenState variant="loading" compact />
										) : (
											<div
												className={styles.content}
												role="group"
												aria-label="Найденные контакты"
											>
												{options.map(item => (
													<Button
														key={item.id}
														variant="secondary"
														disabled={command.locked}
														onClick={() => {
															setSelected(item)
															toast('Контакт выбран')
														}}
													>
														{item.name}
														{item.kind === 'contacts' && item.phone
															? ` · ${item.phone}`
															: ''}
													</Button>
												))}
												{!options.length ? (
													<p className={styles.muted}>
														Контактов не найдено.
													</p>
												) : null}
												{(contacts.data?.total ?? 0) > 10 || page > 1 ? (
													<div className={styles.pagination}>
														<Button
															size="sm"
															variant="ghost"
															disabled={command.locked || page === 1}
															onClick={() => setPage(value => value - 1)}
														>
															Назад
														</Button>
														<span>
															Страница {page} · всего{' '}
															{contacts.data?.total}
														</span>
														<Button
															size="sm"
															variant="ghost"
															disabled={
																command.locked ||
																page * 10 >= (contacts.data?.total ?? 0)
															}
															onClick={() => setPage(value => value + 1)}
														>
															Далее
														</Button>
													</div>
												) : null}
											</div>
										)}
										{canCreateContacts ? (
											<Button
												variant="secondary"
												disabled={command.locked}
												onClick={() => {
													setCreatingContact(true)
													toast('Новый контакт для сделки')
												}}
											>
												Создать контакт
											</Button>
										) : null}
									</>
								)}
							</>
						)}
					</section>
					<fieldset className={styles.fields} disabled={command.locked}>
						<NextActionFields
							title={taskTitle}
							onTitleChange={setTaskTitle}
							due={due}
							onDueChange={setDue}
							disabled={command.locked}
							titleLabel="Первое действие"
							dueLabel="Срок действия"
						/>
					</fieldset>
				</form>
			</Drawer>
			{creatingContact ? (
				<CustomerEditor
					workspaceId={context.workspace.workspaceId}
					kind="contacts"
					canWrite={canCreateContacts}
					scopeKey={context.scopeKey}
					initialName={searchInput}
					onClose={() => setCreatingContact(false)}
					onSaved={contact => {
						setSelected(contact)
						void client.invalidateQueries({
							queryKey: ['crm-customers', context.workspace.workspaceId]
						})
						void contacts.refetch()
					}}
				/>
			) : null}
		</>
	)
}
