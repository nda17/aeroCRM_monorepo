'use client'

import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import {
	Suspense,
	useEffect,
	useLayoutEffect,
	useRef,
	useState
} from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'

import {
	canOpenCrmWorkspace,
	getCrmPermissions,
	getWorkspaceDisplaySummaries,
	CrmWorkspaceAccessProvider
} from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { listWorkspaceClosures } from '@/entities/workspace-closure'
import { billingHref } from '@/entities/crm-billing'
import {
	pendingClosureCommand,
	WorkspaceClosureCard,
	WorkspaceClosureList,
	WorkspaceClosureStatus
} from '@/features/manage-workspace-closure'
import { getRuntimeConfig } from '@/shared/config/runtime'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import { Button, ScreenState, SelectField } from '@/shared/ui'

import {
	activateCrmTrial,
	createPersonalCrmWorkspace,
	CrmWorkspaceRequiredError,
	getCrmAccessBootstrap
} from '../api/crm-access.api'
import { crmAccessQueryKey } from '../model/crm-access.queries'
import {
	sessionOwnedRequest,
	type SessionOwnedRequest
} from '../model/session-owned-request'
import styles from './AccessGate.module.scss'
import { CrmOnboarding } from './onboarding/CrmOnboarding'

const RetryState = ({
	onRetry,
	isRetrying = false
}: {
	onRetry: () => void
	isRetrying?: boolean
}) => (
	<ScreenState
		variant="error"
		title="CRM временно недоступна"
		description="Не удалось безопасно подтвердить доступ. Рабочая область останется закрыта."
		action={
			<Button onClick={onRetry} isLoading={isRetrying}>
				Повторить
			</Button>
		}
	/>
)

const blockedCopy = {
	GRACE: [
		'Настройка aeroCRM не завершена',
		'Не удалось подтвердить готовность рабочего пространства. Обновите статус.'
	],
	READ_ONLY: [
		'Доступ только для чтения',
		'Период редактирования завершён до настройки CRM. Данные сохраняются; завершить настройку можно после продления доступа.'
	],
	EXPIRED: [
		'Доступ завершён',
		'Срок доступа закончился. Рабочая область закрыта.'
	],
	CANCELLED: ['Подписка отменена', 'Рабочая область закрыта.'],
	SUSPENDED: [
		'Доступ приостановлен',
		'Новые действия недоступны. Обновите состояние, чтобы проверить ход закрытия пространства.'
	]
} as const

export const AccessGate = ({ children }: PropsWithChildren) => (
	<Suspense
		fallback={
			<div className={styles.gate}>
				<ScreenState
					variant="loading"
					title="Проверяем рабочее пространство"
				/>
			</div>
		}
	>
		<WorkspaceAccessGate>{children}</WorkspaceAccessGate>
	</Suspense>
)

const WorkspaceAccessGate = ({ children }: PropsWithChildren) => {
	const session = useSessionStore(state => state.session)
	const sessionRevision = useSessionStore(state => state.sessionRevision)
	const setAnonymous = useSessionStore(state => state.setAnonymous)
	const queryClient = useQueryClient()
	const searchParams = useSearchParams()
	const pathname = usePathname()
	const router = useRouter()
	const targets = searchParams.getAll('workspaceId')
	const invalidTarget =
		targets.length > 1 || (targets.length === 1 && !isUuidV4(targets[0]))
	const selectionOwner = JSON.stringify([session?.userId, sessionRevision])
	const requestedWorkspaceId =
		targets.length === 1 && !invalidTarget ? targets[0] : undefined
	const [selection, setSelection] = useState<{
		owner: string
		id?: string
		query?: string
	}>({
		owner: selectionOwner,
		id: requestedWorkspaceId,
		query: requestedWorkspaceId
	})
	// Keep the validated choice through sidebar links that omit the query, but
	// never reuse a previous account's selection. Adjust before rendering children.
	if (
		selection.owner !== selectionOwner ||
		selection.query !== requestedWorkspaceId
	)
		setSelection({
			owner: selectionOwner,
			id:
				requestedWorkspaceId ??
				(selection.owner === selectionOwner ? selection.id : undefined),
			query: requestedWorkspaceId
		})
	const workspaceId =
		requestedWorkspaceId ??
		(selection.owner === selectionOwner ? selection.id : undefined)
	const selectWorkspace = (selected?: string) => {
		setSelection({
			owner: selectionOwner,
			id: selected,
			query: requestedWorkspaceId
		})
		const nextParams = new URLSearchParams(searchParams.toString())
		if (selected) nextParams.set('workspaceId', selected)
		else nextParams.delete('workspaceId')
		router.replace(
			`${pathname}${nextParams.size ? `?${nextParams.toString()}` : ''}`,
			{ scroll: false }
		)
	}
	const choiceScope = JSON.stringify([selectionOwner, workspaceId])
	const [choice, setChoice] = useState({ scope: choiceScope, value: '' })
	const commandIdRef = useRef<string | undefined>(undefined)
	useEffect(() => {
		commandIdRef.current = undefined
	}, [session?.userId, sessionRevision, workspaceId])
	const accessKey = crmAccessQueryKey(
		session?.userId ?? '',
		sessionRevision,
		workspaceId
	)
	const accessScope = JSON.stringify([accessKey, invalidTarget])
	const currentAccessScope = useRef<string | null>(null)
	useLayoutEffect(() => {
		currentAccessScope.current = accessScope
		return () => {
			currentAccessScope.current = null
		}
	}, [accessScope])
	const access = useQuery({
		queryKey: accessKey,
		queryFn: async () => {
			const bootstrap = await getCrmAccessBootstrap(
				session!.accessToken,
				workspaceId
			)
			if (workspaceId) {
				if (
					bootstrap.state === 'WORKSPACE_SELECTION_REQUIRED' ||
					bootstrap.selectedWorkspaceId !== workspaceId
				)
					throw invalidContractError()
				if (canOpenCrmWorkspace(bootstrap)) {
					const permissions = await getCrmPermissions(
						session!.accessToken,
						workspaceId
					)
					if (permissions.subject !== session!.userId)
						throw invalidContractError()
				}
			}
			return bootstrap
		},
		enabled: Boolean(session) && !invalidTarget,
		retry: false
	})
	const workspaceNames = useQuery({
		queryKey: [
			'crm-workspace-display-summaries',
			session?.userId,
			sessionRevision
		],
		queryFn: () =>
			getWorkspaceDisplaySummaries(session!.accessToken, session!.userId),
		enabled:
			!!session && access.data?.state === 'WORKSPACE_SELECTION_REQUIRED',
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	const ownedClosures = useQuery({
		queryKey: ['crm-workspace-closures', session?.userId, sessionRevision],
		queryFn: () =>
			listWorkspaceClosures(session!.accessToken, session!.userId),
		enabled:
			!!session &&
			!invalidTarget &&
			(access.data?.state === 'SUSPENDED' ||
				access.data?.state === 'WORKSPACE_SELECTION_REQUIRED' ||
				access.isError),
		retry: false,
		staleTime: 0,
		gcTime: 0
	})

	useEffect(() => {
		if (
			access.error instanceof AuthenticatedApiError &&
			access.error.kind === 'unauthorized' &&
			useSessionStore.getState().session?.userId === session?.userId &&
			useSessionStore.getState().session?.accessToken ===
				session?.accessToken &&
			useSessionStore.getState().sessionRevision === sessionRevision
		)
			setAnonymous()
	}, [
		access.error,
		setAnonymous,
		session?.userId,
		session?.accessToken,
		sessionRevision
	])

	const trial = useMutation({
		mutationFn: (
			request: SessionOwnedRequest<
				{ workspaceId: string; commandId: string },
				Awaited<ReturnType<typeof activateCrmTrial>>
			> & {
				accessKey: ReturnType<typeof crmAccessQueryKey>
				accessScope: string
			}
		) => request.execute(),
		onSuccess: (result, request) => {
			if (
				!request.isCurrent() ||
				currentAccessScope.current !== request.accessScope
			)
				return
			queryClient.setQueryData(request.accessKey, result)
			commandIdRef.current = undefined
			toast.success(
				result.activated
					? 'Бесплатный период на 10 дней запущен'
					: 'Доступ уже активирован'
			)
		},
		onError: (error, request) => {
			if (
				!request.isCurrent() ||
				currentAccessScope.current !== request.accessScope
			)
				return
			if (
				error instanceof AuthenticatedApiError &&
				error.kind === 'unauthorized'
			)
				setAnonymous()
			else {
				if (
					error instanceof AuthenticatedApiError &&
					(error.kind === 'conflict' || error.kind === 'forbidden')
				) {
					commandIdRef.current = undefined
					void access.refetch()
				}
				toast.error('Не удалось запустить бесплатный период')
			}
		}
	})
	const currentTrial = trial.variables?.accessScope === accessScope
	const trialFailed = currentTrial && trial.isError
	const trialPending = currentTrial && trial.isPending
	const createWorkspace = useMutation({
		mutationFn: (
			request: SessionOwnedRequest<null, { workspaceId: string }> & {
				scope: string
			}
		) => request.execute(),
		onSuccess: (result, request) => {
			if (
				!request.isCurrent() ||
				currentAccessScope.current !== request.scope
			)
				return
			toast.success('Рабочее пространство готово')
			selectWorkspace(result.workspaceId)
		},
		onError: (_, request) => {
			if (
				!request.isCurrent() ||
				currentAccessScope.current !== request.scope
			)
				return
			toast.error(
				'Не удалось подтвердить создание пространства. Повторите попытку.'
			)
		}
	})

	if (invalidTarget)
		return (
			<div className={styles.gate}>
				<ScreenState
					variant="permission"
					title="Некорректное рабочее пространство"
					description="Ссылка не содержит единственный допустимый идентификатор. Личное пространство не выбирается автоматически."
					action={
						<Button
							variant="secondary"
							onClick={() => {
								selectWorkspace()
							}}
						>
							Выбрать пространство
						</Button>
					}
				/>
			</div>
		)
	if (!session || access.isPending)
		return (
			<div className={styles.gate}>
				<ScreenState
					variant="loading"
					title="Проверяем доступ к aeroCRM"
				/>
			</div>
		)
	const closedWorkspaceId = workspaceId ?? access.data?.selectedWorkspaceId
	const pendingClosure = closedWorkspaceId
		? pendingClosureCommand(
				`${session.userId}:${sessionRevision}:${closedWorkspaceId}`
			)
		: null
	const validatedOwnedClosures =
		!ownedClosures.isError &&
		ownedClosures.data?.scope.subject === session.userId
			? ownedClosures.data
			: undefined
	const selectedClosure = validatedOwnedClosures?.items.find(
		item => item.workspaceId === closedWorkspaceId
	)
	if (selectedClosure)
		return (
			<div className={`${styles.gate} ${styles.gateColumn}`}>
				<WorkspaceClosureStatus
					key={`${session.userId}:${sessionRevision}:${selectedClosure.id}`}
					initial={selectedClosure}
				/>
				<Button
					variant="secondary"
					onClick={() => selectWorkspace(undefined)}
				>
					Выбрать другое пространство
				</Button>
			</div>
		)
	if (pendingClosure && closedWorkspaceId)
		return (
			<div className={`${styles.gate} ${styles.gateColumn}`}>
				<WorkspaceClosureCard
					key={`${session.userId}:${sessionRevision}:${closedWorkspaceId}`}
					workspaceId={closedWorkspaceId}
				/>
				<Button
					variant="secondary"
					onClick={() => selectWorkspace(undefined)}
				>
					Выбрать другое пространство
				</Button>
			</div>
		)
	if (
		access.error instanceof CrmWorkspaceRequiredError &&
		(ownedClosures.isPending ||
			(ownedClosures.isFetching && !validatedOwnedClosures?.items.length))
	)
		return (
			<div className={styles.gate}>
				<ScreenState
					variant="loading"
					title="Проверяем сохранённые пространства"
				/>
			</div>
		)
	if (
		access.error instanceof CrmWorkspaceRequiredError &&
		ownedClosures.isError
	)
		return (
			<div className={styles.gate}>
				<ScreenState
					variant="error"
					title="Не удалось проверить пространства"
					description="Повторите проверку перед созданием нового пространства."
					action={
						<Button onClick={() => void ownedClosures.refetch()}>
							Повторить
						</Button>
					}
				/>
			</div>
		)
	if (
		access.error instanceof CrmWorkspaceRequiredError &&
		validatedOwnedClosures?.items.length
	)
		return (
			<div className={`${styles.gate} ${styles.gateColumn}`}>
				<WorkspaceClosureList onSelect={selectWorkspace} />
			</div>
		)
	if (access.error instanceof CrmWorkspaceRequiredError)
		return (
			<div className={styles.gate}>
				<ScreenState
					variant="empty"
					title="Создайте рабочее пространство"
					description="У вас пока нет рабочего пространства CRM. Создайте его для своей команды. Пробный период на 10 дней запускается отдельно."
					action={
						<div className={styles.actions}>
							<Button
								isLoading={createWorkspace.isPending}
								disabled={access.isFetching}
								onClick={() =>
									createWorkspace.mutate({
										scope: accessScope,
										...sessionOwnedRequest(
											session,
											sessionRevision,
											null,
											createPersonalCrmWorkspace
										)
									})
								}
							>
								Создать рабочее пространство
							</Button>
							<a href={`${getRuntimeConfig().mainAppOrigin}/cabinet`}>
								Личный кабинет
							</a>
						</div>
					}
				/>
			</div>
		)
	if (access.isError && !access.data)
		return (
			<div className={styles.gate}>
				<RetryState
					isRetrying={access.isFetching}
					onRetry={() => {
						void access.refetch()
						void ownedClosures.refetch()
					}}
				/>
			</div>
		)

	const data = access.data
	if (access.isError && data.state !== 'ONBOARDING')
		return (
			<div className={styles.gate}>
				<RetryState
					isRetrying={access.isFetching}
					onRetry={() => {
						void access.refetch()
						void ownedClosures.refetch()
					}}
				/>
			</div>
		)
	if (data.state === 'WORKSPACE_SELECTION_REQUIRED') {
		if (workspaceNames.isPending)
			return (
				<div className={styles.gate}>
					<ScreenState
						variant="loading"
						title="Загружаем названия пространств"
					/>
				</div>
			)
		const summaries =
			!workspaceNames.isError &&
			workspaceNames.data?.scope.subject === session.userId
				? workspaceNames.data.items
				: []
		const names = data.workspaces.map(workspace => {
			const summary = summaries.find(
				item =>
					item.workspaceId === workspace.workspaceId &&
					item.membershipRole === workspace.role
			)
			return summary?.displayName?.trim() || null
		})
		const counts = new Map<string, number>()
		for (const name of names) {
			if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
		}
		let codeLength = 8
		while (
			codeLength < 36 &&
			new Set(
				data.workspaces.map(item => item.workspaceId.slice(0, codeLength))
			).size < data.workspaces.length
		)
			codeLength += 1
		const workspaceLabel = (index: number) => {
			const workspace = data.workspaces[index]
			const name = names[index]
			const code = workspace.workspaceId.slice(0, codeLength)
			const title = name
				? `${name}${(counts.get(name) ?? 0) > 1 ? ` · ${code}` : ''}`
				: `Пространство без названия · ${code}`
			return `${title} · ${workspace.role === 'OWNER' ? 'Владелец' : 'Участник'}`
		}
		const selected =
			(choice.scope === choiceScope ? choice.value : '') ||
			data.workspaces[0]?.workspaceId ||
			''
		return (
			<div className={`${styles.gate} ${styles.gateColumn}`}>
				<div className={styles.panel}>
					<h1>Выберите рабочее пространство</h1>
					<form
						className={styles.form}
						onSubmit={event => {
							event.preventDefault()
							if (
								access.isFetching ||
								!data.workspaces.some(
									item => item.workspaceId === selected
								)
							)
								return
							if (workspaceId === selected) void access.refetch()
							else selectWorkspace(selected)
						}}
					>
						<SelectField
							label="Рабочее пространство"
							value={selected}
							onChange={event =>
								setChoice({
									scope: choiceScope,
									value: event.target.value
								})
							}
						>
							{data.workspaces.map((item, index) => (
								<option value={item.workspaceId} key={item.workspaceId}>
									{workspaceLabel(index)}
								</option>
							))}
						</SelectField>
						{workspaceNames.isError ? (
							<div className={styles.nameNotice}>
								<p>
									Названия пространств сейчас недоступны. Выберите
									пространство по короткому коду.
								</p>
								<Button
									variant="secondary"
									onClick={() => void workspaceNames.refetch()}
								>
									Загрузить названия ещё раз
								</Button>
							</div>
						) : null}
						<Button type="submit" isLoading={access.isFetching}>
							Продолжить
						</Button>
					</form>
				</div>
				<WorkspaceClosureList onSelect={selectWorkspace} />
			</div>
		)
	}

	if (canOpenCrmWorkspace(data))
		return access.isFetching ? (
			<div className={styles.gate}>
				<ScreenState
					variant="loading"
					title="Подтверждаем доступ к aeroCRM"
				/>
			</div>
		) : (
			<CrmWorkspaceAccessProvider access={data}>
				{children}
			</CrmWorkspaceAccessProvider>
		)
	const billingUrl = billingHref(data.selectedWorkspaceId)
	const billingLink =
		getRuntimeConfig().crmBillingEnabled &&
		data.membership.role === 'OWNER' &&
		!access.isFetching &&
		!access.isError &&
		billingUrl ? (
			<a href={billingUrl} className={styles.billingLink}>
				Подписка и оплата aeroCRM
			</a>
		) : null
	if (data.state === 'ONBOARDING')
		return (
			<div className={styles.gate}>
				<div className={styles.onboardingContent}>
					<CrmOnboarding
						key={`${session.userId}:${sessionRevision}:${data.selectedWorkspaceId}`}
						access={data}
						accessRevalidating={access.isFetching}
						accessValidationFailed={access.isError}
						onInstalled={result => {
							queryClient.setQueryData(accessKey, result.access)
						}}
						onRevalidateAccess={() => {
							void access.refetch()
						}}
					/>
					{billingLink}
				</div>
			</div>
		)
	if (data.state === 'NOT_ACTIVATED')
		return (
			<div className={styles.gate}>
				<ScreenState
					variant="permission"
					title="aeroCRM ещё не активирована"
					description={
						trialFailed
							? 'Запустить бесплатный период не удалось. Повторите запрос: будет использован тот же идентификатор команды.'
							: data.membership.role === 'OWNER'
								? 'Бесплатный период запускается только по вашему явному действию.'
								: 'Запустить бесплатный период может только владелец рабочего пространства.'
					}
					action={
						<div className={styles.actions}>
							<Button
								disabled={
									data.membership.role !== 'OWNER' || access.isFetching
								}
								isLoading={trialPending || access.isFetching}
								onClick={() => {
									if (access.isFetching) return
									commandIdRef.current ??= crypto.randomUUID()
									trial.mutate({
										accessKey,
										accessScope,
										...sessionOwnedRequest(
											session,
											sessionRevision,
											{
												workspaceId: data.selectedWorkspaceId,
												commandId: commandIdRef.current
											},
											activateCrmTrial
										)
									})
								}}
							>
								{trialFailed
									? 'Повторить запуск бесплатных 10 дней'
									: 'Попробовать бесплатно 10 дней'}
							</Button>
							{billingLink}
						</div>
					}
				/>
			</div>
		)

	const copy =
		data.state === 'ACTIVE'
			? [
					'Не удалось подтвердить готовность aeroCRM',
					'Обновите состояние доступа.'
				]
			: blockedCopy[data.state]
	return (
		<div className={styles.gate}>
			<ScreenState
				variant="permission"
				title={copy[0]}
				description={copy[1]}
				action={
					<div className={styles.actions}>
						<Button
							variant="secondary"
							isLoading={access.isFetching}
							onClick={() => {
								void access.refetch()
								if (data.state === 'SUSPENDED')
									void ownedClosures.refetch()
							}}
						>
							Обновить статус
						</Button>
						{billingLink}
					</div>
				}
			/>
		</div>
	)
}
