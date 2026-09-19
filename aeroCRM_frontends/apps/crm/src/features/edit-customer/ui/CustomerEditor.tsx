'use client'

import { useSessionStore } from '@/entities/session'
import { getCrmPermissions } from '@/entities/crm-access'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import {
	findCustomerDuplicates,
	getCustomer,
	listCustomers,
	mutateCustomer,
	validContactCallPreferences,
	type Customer,
	type CustomerKind,
	type CustomerMutation
} from '@/entities/customer'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	CRM_PHONE_INPUT_ERROR,
	CRM_PHONE_INPUT_MAX_LENGTH,
	CRM_PHONE_INPUT_PLACEHOLDER,
	formatCrmPhoneInput,
	isCrmPhoneInputValid,
	parseCrmPhoneInput
} from '@/shared/lib/phone'
import {
	Button,
	Drawer,
	ScreenState,
	SelectField,
	TextField,
	TextareaField
} from '@/shared/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import toast from 'react-hot-toast'
import styles from './CustomerEditor.module.scss'
import { CompanyLookup } from './CompanyLookup'
import { ContactCallPanel } from './ContactCallPanel'

interface EditorProps {
	workspaceId: string
	kind: CustomerKind
	id?: string
	initialName?: string
	canWrite: boolean
	scopeKey?: string
	onClose: () => void
	onSaved: (record: Customer) => void
}

interface Draft {
	name: string
	phone: string
	email: string
	companyId: string
	notes: string
	inn: string
	website: string
	legalName: string
	kpp: string
	ogrn: string
	legalAddress: string
	entityType: '' | 'LEGAL' | 'INDIVIDUAL'
	timeZone: string
	preferredCallStart: string
	preferredCallEnd: string
}

export const CustomerEditor = (props: EditorProps) => {
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const record = useQuery({
		queryKey: [
			'crm-customer-detail',
			props.workspaceId,
			session?.userId,
			revision,
			props.scopeKey,
			props.kind,
			2,
			props.id
		],
		enabled: !!props.id && !!session,
		queryFn: () =>
			getCustomer(
				session!.accessToken,
				props.kind,
				props.workspaceId,
				props.id!
			),
		retry: false,
		gcTime: 0,
		staleTime: 0,
		refetchOnWindowFocus: false
	})
	const owner = JSON.stringify([
		props.workspaceId,
		session?.userId,
		revision,
		props.scopeKey,
		props.kind,
		props.id
	])
	const [snapshot, setSnapshot] = useState<{
		owner: string
		record: Customer
	} | null>(null)
	if (record.data && snapshot?.owner !== owner)
		setSnapshot({ owner, record: record.data })
	const baseline =
		snapshot?.owner === owner ? snapshot.record : record.data
	const accessDenied =
		record.error instanceof AuthenticatedApiError &&
		['unauthorized', 'forbidden', 'notFound'].includes(record.error.kind)
	if (props.id && (!baseline || accessDenied))
		return (
			<Drawer isOpen onClose={props.onClose} title="Карточка клиента">
				<ScreenState
					variant={
						record.isError
							? record.error instanceof AuthenticatedApiError &&
								record.error.kind === 'forbidden'
								? 'permission'
								: 'error'
							: 'loading'
					}
					description={record.error?.message}
					action={
						record.isError ? (
							<Button
								variant="secondary"
								onClick={() => void record.refetch()}
							>
								Повторить
							</Button>
						) : undefined
					}
				/>
			</Drawer>
		)
	return (
		<CustomerForm
			key={
				`${props.workspaceId}:${session?.userId}:${revision}:${props.scopeKey}:v2:` +
				(baseline
					? `${baseline.id}:${baseline.version}`
					: `new:${props.kind}`)
			}
			{...props}
			record={baseline}
			serverChanged={
				!!baseline &&
				!!record.data &&
				record.data.version !== baseline.version
			}
			reload={() => {
				void record.refetch().then(result => {
					if (result.data && !result.isError)
						setSnapshot({ owner, record: result.data })
				})
			}}
		/>
	)
}

const CustomerForm = ({
	workspaceId,
	kind,
	id,
	initialName,
	canWrite,
	scopeKey,
	onClose,
	onSaved,
	record,
	serverChanged,
	reload
}: EditorProps & {
	record?: Customer
	serverChanged: boolean
	reload: () => void
}) => {
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const [archiveConfirm, setArchiveConfirm] = useState(false)
	const [companySearch, setCompanySearch] = useState('')
	const [companyTerm, setCompanyTerm] = useState('')
	const [companyPage, setCompanyPage] = useState(1)
	const form = useForm<Draft>({
		defaultValues: {
			name: record?.name ?? initialName ?? '',
			notes: record?.notes ?? '',
			phone:
				record?.kind === 'contacts'
					? formatCrmPhoneInput(record.phone ?? '')
					: '',
			email: record?.kind === 'contacts' ? (record.email ?? '') : '',
			companyId:
				record?.kind === 'contacts' ? (record.companyId ?? '') : '',
			timeZone: record?.kind === 'contacts' ? (record.timeZone ?? '') : '',
			preferredCallStart:
				record?.kind === 'contacts'
					? (record.preferredCallStart ?? '')
					: '',
			preferredCallEnd:
				record?.kind === 'contacts' ? (record.preferredCallEnd ?? '') : '',
			inn: record?.kind === 'companies' ? (record.inn ?? '') : '',
			website: record?.kind === 'companies' ? (record.website ?? '') : '',
			legalName:
				record?.kind === 'companies' ? (record.legalName ?? '') : '',
			kpp: record?.kind === 'companies' ? (record.kpp ?? '') : '',
			ogrn: record?.kind === 'companies' ? (record.ogrn ?? '') : '',
			legalAddress:
				record?.kind === 'companies' ? (record.legalAddress ?? '') : '',
			entityType:
				record?.kind === 'companies' ? (record.entityType ?? '') : ''
		}
	})
	const companies = useQuery({
		queryKey: [
			'crm-company-picker',
			workspaceId,
			2,
			session?.userId,
			revision,
			scopeKey,
			companyTerm,
			companyPage
		],
		enabled: kind === 'contacts' && canWrite && !!session,
		queryFn: () =>
			listCustomers(
				session!.accessToken,
				'companies',
				workspaceId,
				companyPage,
				25,
				companyTerm
			),
		retry: false,
		gcTime: 0
	})
	const linkedCompanyId =
		record?.kind === 'contacts' ? record.companyId : null
	const linkedCompany = useQuery({
		queryKey: [
			'crm-company-link',
			workspaceId,
			2,
			session?.userId,
			revision,
			scopeKey,
			linkedCompanyId
		],
		enabled: !!linkedCompanyId && !!session,
		queryFn: () =>
			getCustomer(
				session!.accessToken,
				'companies',
				workspaceId,
				linkedCompanyId!
			),
		retry: false,
		gcTime: 0
	})
	const memory = useMemoryCommand<CustomerMutation, Customer>(
		{
			owner: commandOwner(session?.userId, revision),
			workspaceId,
			view: scopeKey
		},
		`customers:v2:${kind}:${id ?? 'new'}`,
		canWrite,
		async () => {
			if (!session || !navigator.onLine)
				throw new AuthenticatedApiError(
					'temporary',
					'Нет подключения к сети.'
				)
			const permissions = await getCrmPermissions(
				session.accessToken,
				workspaceId
			)
			const current = useSessionStore.getState()
			if (
				!current.session ||
				current.session.accessToken !== session.accessToken ||
				current.sessionRevision !== revision ||
				permissions.subject !== current.session.userId
			)
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия изменилась.'
				)
			if (
				permissions.state === 'READ_ONLY' ||
				!permissions.permissions.includes('customers:write')
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Изменения недоступны для текущей роли или подписки.'
				)
			return current.session.accessToken
		},
		mutateCustomer,
		(saved, completed) => {
			toast.success(
				completed.archive ? 'Запись архивирована' : 'Изменения сохранены'
			)
			onSaved(saved)
			onClose()
		}
	)
	const mutation = { error: memory.error, isPending: memory.running }
	const command = memory.uncertain
	const duplicates = useMutation({
		mutationFn: ({ phone, email }: { phone: string; email: string }) =>
			findCustomerDuplicates(
				session!.accessToken,
				workspaceId,
				phone,
				email
			),
		onError: error => toast.error(error.message)
	})
	const authorizationDenied =
		!memory.uncertain &&
		mutation.error instanceof AuthenticatedApiError &&
		['unauthorized', 'forbidden'].includes(mutation.error.kind)
	const locked = memory.locked
	const editable = canWrite && !locked && !authorizationDenied
	const close = () => {
		if (locked) {
			toast(
				'Сначала повторите запрос с неизвестным результатом. Повтор безопасен.'
			)
			return
		}
		onClose()
	}
	const dispatch = (pending: CustomerMutation) => {
		if (!canWrite || authorizationDenied || !session || memory.running)
			return
		void memory.execute(() => pending)
	}
	const submit = (event: FormEvent<HTMLFormElement>) => {
		if (memory.uncertain) {
			event.preventDefault()
			void memory.execute()
			return
		}
		void form.handleSubmit(
			draft => {
				if (!canWrite || authorizationDenied || conflict) return
				const nullable = (value: string) => value.trim() || null
				const callPreferences = {
					timeZone: nullable(draft.timeZone),
					preferredCallStart: nullable(draft.preferredCallStart),
					preferredCallEnd: nullable(draft.preferredCallEnd)
				}
				if (
					kind === 'contacts' &&
					!validContactCallPreferences(callPreferences)
				) {
					toast.error('Проверьте часовой пояс и удобные часы клиента')
					return
				}
				dispatch({
					kind,
					schemaVersion: 2,
					workspaceId,
					id,
					commandId: crypto.randomUUID(),
					...(record ? { expectedVersion: record.version } : {}),
					fields: {
						name: draft.name.trim(),
						notes: nullable(draft.notes),
						teamId: record?.teamId ?? null,
						...(kind === 'contacts'
							? {
									...callPreferences,
									phone: parseCrmPhoneInput(draft.phone),
									email: nullable(draft.email)?.toLowerCase() ?? null,
									companyId: nullable(draft.companyId)
								}
							: {
									inn: nullable(draft.inn),
									website: nullable(draft.website),
									legalName: nullable(draft.legalName),
									kpp: nullable(draft.kpp),
									ogrn: nullable(draft.ogrn),
									legalAddress: nullable(draft.legalAddress),
									entityType: draft.entityType || null
								})
					}
				})
			},
			() => toast.error('Проверьте выделенные поля')
		)(event)
	}
	const checkDuplicates = async () => {
		if (!(await form.trigger(['phone', 'email']))) return
		const phone = parseCrmPhoneInput(form.getValues('phone')) || ''
		const email = form.getValues('email').trim()
		if (!phone && !email) {
			toast('Укажите телефон или email для поиска совпадений')
			return
		}
		duplicates.mutate({ phone, email })
	}
	const title = id
		? (record?.name ?? 'Карточка клиента')
		: kind === 'contacts'
			? 'Новый контакт'
			: 'Новая компания'
	const selectedCompanyId = useWatch({
		control: form.control,
		name: 'companyId'
	})
	const conflict =
		serverChanged ||
		(!memory.uncertain &&
			mutation.error instanceof AuthenticatedApiError &&
			mutation.error.kind === 'conflict')
	const requisites = useWatch({
		control: form.control,
		name: [
			'inn',
			'name',
			'legalName',
			'kpp',
			'ogrn',
			'legalAddress',
			'entityType'
		]
	})
	const callPreferences = useWatch({
		control: form.control,
		name: ['timeZone', 'preferredCallStart', 'preferredCallEnd']
	})
	return (
		<Drawer
			isOpen
			onClose={close}
			title={title}
			description={
				canWrite
					? 'Изменения сохраняются в клиентской базе вашей команды.'
					: 'Доступен только просмотр карточки.'
			}
			footer={
				<>
					<Button variant="secondary" onClick={close} disabled={locked}>
						Закрыть
					</Button>
					{canWrite ? (
						<Button
							form="customer-editor"
							type="submit"
							tooltip={
								command
									? 'Повторить отправленную команду с теми же данными, чтобы подтвердить результат'
									: 'Сохранить данные карточки в клиентской базе команды'
							}
							isLoading={mutation.isPending}
							disabled={conflict || authorizationDenied}
						>
							{command ? 'Повторить запрос' : 'Сохранить'}
						</Button>
					) : null}
				</>
			}
		>
			<form
				id="customer-editor"
				className={styles.form}
				onSubmit={submit}
				noValidate
			>
				{mutation.error || serverChanged ? (
					<div className={styles.notice} role="alert">
						<p>
							{serverChanged
								? 'Карточка обновлена другим действием. Ваш черновик сохранён; перед сохранением проверьте актуальную версию.'
								: mutation.error?.message}
						</p>
						{command ? (
							<p>
								Ответ не подтверждён. Поля временно заблокированы;
								повторная отправка использует ту же команду и не создаст
								дубль.
							</p>
						) : null}
						{conflict ? (
							<Button
								variant="secondary"
								size="sm"
								tooltip="Загрузить актуальную карточку с сервера. После подтверждения несохранённый черновик будет сброшен"
								onClick={() => {
									if (
										window.confirm(
											'Загрузить актуальную карточку? Несохранённый черновик будет сброшен.'
										)
									) {
										memory.reset()
										reload()
									}
								}}
							>
								Загрузить актуальную версию
							</Button>
						) : null}
					</div>
				) : null}
				<TextField
					label={kind === 'contacts' ? 'Имя' : 'Название компании'}
					required
					maxLength={200}
					readOnly={!editable}
					error={form.formState.errors.name?.message}
					{...form.register('name', {
						validate: value => !!value.trim() || 'Укажите имя или название'
					})}
				/>
				{kind === 'contacts' ? (
					<>
						<Controller
							name="phone"
							control={form.control}
							rules={{
								validate: value =>
									isCrmPhoneInputValid(value) || CRM_PHONE_INPUT_ERROR
							}}
							render={({ field }) => (
								<TextField
									{...field}
									label="Телефон"
									type="tel"
									inputMode="tel"
									autoComplete="tel"
									placeholder={CRM_PHONE_INPUT_PLACEHOLDER}
									hint="Можно вставить номер с пробелами и скобками. Для другой страны укажите + и код страны."
									maxLength={CRM_PHONE_INPUT_MAX_LENGTH}
									readOnly={!editable}
									error={form.formState.errors.phone?.message}
									onChange={event => {
										if (editable)
											field.onChange(
												formatCrmPhoneInput(event.currentTarget.value)
											)
									}}
								/>
							)}
						/>
						<TextField
							label="Email"
							type="email"
							maxLength={254}
							readOnly={!editable}
							error={form.formState.errors.email?.message}
							{...form.register('email', {
								pattern: {
									value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
									message: 'Укажите корректный email'
								}
							})}
						/>
						<ContactCallPanel
							value={{
								timeZone: callPreferences[0] || null,
								preferredCallStart: callPreferences[1] || null,
								preferredCallEnd: callPreferences[2] || null
							}}
							onChange={(key, value) => {
								if (editable)
									form.setValue(key, value, { shouldDirty: true })
							}}
							editable={editable}
							disabled={locked || authorizationDenied}
							record={record}
						/>
						<div className={styles.secondarySection}>
							<Button
								variant="secondary"
								size="sm"
								tooltip="Найти похожие контакты по введённым данным. Записи не объединяются автоматически"
								isLoading={duplicates.isPending}
								disabled={!editable}
								onClick={() => void checkDuplicates()}
							>
								Проверить совпадения
							</Button>
							{duplicates.data ? (
								<div role="status" className={styles.hint}>
									{duplicates.data.items.filter(item => item.id !== id)
										.length ? (
										<>
											<p>
												Найдены похожие контакты. Автоматически записи не
												объединяются.
											</p>
											<ul>
												{duplicates.data.items
													.filter(item => item.id !== id)
													.map(item => (
														<li key={item.id}>
															{item.name}
															{item.kind === 'contacts'
																? ` · ${item.phone ?? item.email ?? 'без контактов'}`
																: ''}
														</li>
													))}
											</ul>
											{duplicates.data.total > 25 ? (
												<p>Показаны первые 25 совпадений.</p>
											) : null}
										</>
									) : (
										'Других совпадений не найдено.'
									)}
								</div>
							) : null}
						</div>
						{canWrite ? (
							<div className={styles.companySearch}>
								<TextField
									label="Найти компанию"
									maxLength={200}
									value={companySearch}
									readOnly={!editable}
									onChange={event => setCompanySearch(event.target.value)}
								/>
								<Button
									variant="secondary"
									size="sm"
									tooltip="Найти компанию для привязки к этому контакту"
									disabled={!editable}
									onClick={() => {
										setCompanyTerm(companySearch.trim())
										setCompanyPage(1)
									}}
								>
									Найти
								</Button>
							</div>
						) : null}
						<SelectField
							label="Компания"
							disabled={!editable}
							{...form.register('companyId')}
						>
							<option value="">Без компании</option>
							{selectedCompanyId &&
							!companies.data?.items.some(
								item => item.id === selectedCompanyId
							) ? (
								<option value={selectedCompanyId}>
									{linkedCompany.data?.id === selectedCompanyId
										? linkedCompany.data.name
										: 'Выбранная компания'}
								</option>
							) : null}
							{!companies.isError
								? companies.data?.items.map(item => (
										<option value={item.id} key={item.id}>
											{item.name}
										</option>
									))
								: null}
						</SelectField>
						{canWrite ? (
							<div className={styles.pickerNavigation}>
								{companies.isError ? (
									<span role="alert">
										Компании не загружены.{' '}
										<Button
											size="sm"
											variant="ghost"
											onClick={() => void companies.refetch()}
										>
											Повторить
										</Button>
									</span>
								) : (
									<>
										<span className={styles.hint}>
											{companies.isFetching
												? 'Загрузка компаний…'
												: `Страница ${companyPage} · найдено ${companies.data?.total ?? 0}`}
										</span>
										<Button
											size="sm"
											variant="ghost"
											disabled={
												!editable ||
												companyPage === 1 ||
												companies.isFetching
											}
											onClick={() => setCompanyPage(page => page - 1)}
										>
											Назад
										</Button>
										<Button
											size="sm"
											variant="ghost"
											disabled={
												!editable ||
												companies.isFetching ||
												!companies.data ||
												companyPage * 25 >= companies.data.total
											}
											onClick={() => setCompanyPage(page => page + 1)}
										>
											Далее
										</Button>
									</>
								)}
							</div>
						) : null}
					</>
				) : (
					<>
						<TextField
							label="ИНН"
							inputMode="numeric"
							maxLength={12}
							readOnly={!editable}
							error={form.formState.errors.inn?.message}
							{...form.register('inn', {
								pattern: {
									value: /^(?:[0-9]{10}|[0-9]{12})$/,
									message: 'ИНН должен содержать 10 или 12 цифр'
								}
							})}
						/>
						<CompanyLookup
							workspaceId={workspaceId}
							scopeKey={scopeKey}
							inn={requisites[0] ?? ''}
							canWrite={editable && !conflict}
							hasExisting={requisites
								.slice(1)
								.some(value => !!value?.trim())}
							hasKpp={!!requisites[3]?.trim()}
							onApply={(item, replace) => {
								const draft = form.getValues()
								if (
									!editable ||
									conflict ||
									draft.inn !== item.inn ||
									(item.entityType === 'INDIVIDUAL' &&
										draft.kpp.trim() &&
										!replace)
								)
									return false
								const values = {
									name: item.name,
									legalName: item.legalName,
									kpp: item.kpp ?? '',
									ogrn: item.ogrn ?? '',
									legalAddress: item.legalAddress ?? '',
									entityType: item.entityType
								}
								let changed = false
								for (const key of Object.keys(
									values
								) as (keyof typeof values)[]) {
									if (
										(replace || !draft[key].trim()) &&
										draft[key] !== values[key]
									) {
										form.setValue(key, values[key], {
											shouldDirty: true,
											shouldValidate: true
										})
										changed = true
									}
								}
								return changed
							}}
						/>
						<SelectField
							label="Тип организации"
							disabled={!editable}
							{...form.register('entityType')}
						>
							<option value="">Не указан</option>
							<option value="LEGAL">Юридическое лицо</option>
							<option value="INDIVIDUAL">
								Индивидуальный предприниматель
							</option>
						</SelectField>
						<TextareaField
							label="Полное наименование"
							rows={2}
							maxLength={2000}
							readOnly={!editable}
							{...form.register('legalName')}
						/>
						<TextField
							label="КПП"
							inputMode="numeric"
							maxLength={9}
							readOnly={!editable}
							error={form.formState.errors.kpp?.message}
							{...form.register('kpp', {
								pattern: {
									value: /^\d{9}$/,
									message: 'КПП должен содержать 9 цифр'
								}
							})}
						/>
						<TextField
							label="ОГРН / ОГРНИП"
							inputMode="numeric"
							maxLength={15}
							readOnly={!editable}
							error={form.formState.errors.ogrn?.message}
							{...form.register('ogrn', {
								pattern: {
									value: /^(?:\d{13}|\d{15})$/,
									message: 'ОГРН — 13 цифр, ОГРНИП — 15 цифр'
								}
							})}
						/>
						<TextareaField
							label="Юридический адрес"
							rows={3}
							maxLength={2000}
							readOnly={!editable}
							{...form.register('legalAddress')}
						/>
						<TextField
							label="Сайт"
							type="url"
							maxLength={2048}
							placeholder="https://example.ru"
							readOnly={!editable}
							error={form.formState.errors.website?.message}
							{...form.register('website', {
								validate: value => {
									if (!value) return true
									try {
										const url = new URL(value)
										return (
											(['http:', 'https:'].includes(url.protocol) &&
												!url.username &&
												!url.password) ||
											'Укажите http(s) адрес без логина и пароля'
										)
									} catch {
										return 'Укажите полный адрес сайта'
									}
								}
							})}
						/>
					</>
				)}
				<TextareaField
					label="Заметки"
					rows={5}
					maxLength={5000}
					readOnly={!editable}
					{...form.register('notes')}
				/>
				{record ? (
					<div className={styles.metadata}>
						<span>
							Создано: {new Date(record.createdAt).toLocaleString('ru-RU')}
						</span>
						<span>
							Обновлено:{' '}
							{new Date(record.updatedAt).toLocaleString('ru-RU')} · версия{' '}
							{record.version}
						</span>
					</div>
				) : null}
				{record && canWrite ? (
					<div className={styles.archive}>
						{archiveConfirm ? (
							<>
								<p>
									Архивировать запись? Она исчезнет из активного списка, но
									история сохранится.
								</p>
								<div className={styles.pickerNavigation}>
									<Button
										variant="danger"
										size="sm"
										tooltip="Убрать запись из активного списка, сохранив её историю"
										disabled={!editable}
										onClick={() =>
											dispatch({
												kind,
												schemaVersion: 2,
												workspaceId,
												id,
												expectedVersion: record.version,
												commandId: crypto.randomUUID(),
												archive: true
											})
										}
									>
										Подтвердить архивирование
									</Button>
									<Button
										variant="ghost"
										size="sm"
										disabled={!editable}
										onClick={() => setArchiveConfirm(false)}
									>
										Отмена
									</Button>
								</div>
							</>
						) : (
							<Button
								variant="ghost"
								size="sm"
								tooltip="Открыть подтверждение удаления записи из активного списка. История сохранится"
								disabled={!editable}
								onClick={() => setArchiveConfirm(true)}
							>
								Архивировать запись
							</Button>
						)}
					</div>
				) : null}
			</form>
		</Drawer>
	)
}
