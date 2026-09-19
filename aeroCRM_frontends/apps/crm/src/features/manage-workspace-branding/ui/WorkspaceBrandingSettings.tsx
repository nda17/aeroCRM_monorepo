'use client'

import {
	getCrmPermissions,
	useCrmPermissions
} from '@/entities/crm-access'
import {
	COMPANY_NAME_LIMIT,
	normalizeCompanyName,
	updateWorkspaceBranding,
	useWorkspaceBranding,
	type BrandingCommand,
	type BrandingResponse
} from '@/entities/crm-workspace-branding'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import { BrandLogo, Button, ScreenState, TextField } from '@/shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import styles from './WorkspaceBrandingSettings.module.scss'

type Context = ReturnType<typeof useWorkspaceBranding>

export const WorkspaceBrandingSettings = () => {
	const context = useWorkspaceBranding()
	return (
		<section className={styles.panel} aria-label="Название компании в CRM">
			<div className={styles.heading}>
				<h2>Ваша компания</h2>
				<p>
					Необязательная подпись под логотипом aeroCRM. Видна сотрудникам
					только в этом пространстве.
				</p>
			</div>
			{context.data ? (
				<BrandingForm
					key={JSON.stringify(context.key)}
					context={context}
					initial={context.data}
				/>
			) : (
				<ScreenState
					compact
					variant={context.query.isError ? 'error' : 'loading'}
					description={
						context.query.isError
							? 'Не удалось загрузить название компании.'
							: 'Загружаем настройки компании'
					}
					action={
						context.query.isError ? (
							<Button
								variant="secondary"
								onClick={() => void context.query.refetch()}
							>
								Повторить загрузку
							</Button>
						) : undefined
					}
				/>
			)}
		</section>
	)
}

const BrandingForm = ({
	context,
	initial
}: {
	context: Context
	initial: BrandingResponse
}) => {
	const { session, sessionRevision, workspace } = context
	const [baseline, setBaseline] = useState(initial.branding)
	const [draft, setDraft] = useState(initial.branding.displayName ?? '')
	const queryClient = useQueryClient()
	const permissions = useCrmPermissions(
		workspace.workspaceId,
		session,
		sessionRevision
	)
	const canWrite =
		!!session &&
		workspace.canWrite &&
		permissions.isSuccess &&
		!permissions.isFetching &&
		permissions.data.subject === session.userId &&
		permissions.data.workspaceId === workspace.workspaceId &&
		permissions.data.state !== 'READ_ONLY' &&
		['OWNER', 'CRM_ADMIN'].includes(permissions.data.role) &&
		permissions.data.permissions.includes('access:manage-team')
	const command = useMemoryCommand<BrandingCommand, BrandingResponse>(
		{
			owner: commandOwner(session?.userId, sessionRevision),
			workspaceId: workspace.workspaceId,
			view: 'workspace-branding'
		},
		'update-company-name',
		canWrite,
		async () => {
			if (!session || !navigator.onLine)
				throw new AuthenticatedApiError(
					'temporary',
					'Нет подключения к сети или действующей сессии.'
				)
			const fresh = await getCrmPermissions(
				session.accessToken,
				workspace.workspaceId
			)
			const current = useSessionStore.getState()
			if (
				current.session?.accessToken !== session.accessToken ||
				current.sessionRevision !== sessionRevision ||
				fresh.subject !== session.userId ||
				fresh.workspaceId !== workspace.workspaceId
			)
				throw new AuthenticatedApiError(
					'unauthorized',
					'Сессия изменилась.'
				)
			if (
				fresh.state === 'READ_ONLY' ||
				!['OWNER', 'CRM_ADMIN'].includes(fresh.role) ||
				!fresh.permissions.includes('access:manage-team')
			)
				throw new AuthenticatedApiError(
					'forbidden',
					'Изменение названия недоступно для текущей роли или подписки.'
				)
			return session.accessToken
		},
		updateWorkspaceBranding,
		result => {
			setBaseline(result.branding)
			setDraft(result.branding.displayName ?? '')
			// A command receipt is immutable, not necessarily the latest branding.
			void queryClient.invalidateQueries({
				queryKey: ['crm-workspace-branding', workspace.workspaceId]
			})
			toast.success(
				result.branding.displayName
					? 'Название компании сохранено'
					: 'Название компании убрано'
			)
		}
	)
	const normalized = normalizeCompanyName(draft)
	const count = [...draft.normalize('NFC').trim()].length
	const invalid = normalized === undefined
	const blocked =
		!!command.error &&
		command.error.kind !== 'validation' &&
		!command.uncertain
	const locked = !canWrite || command.locked || blocked
	const serverChanged = initial.branding.version > baseline.version
	// Adopt fresh data only when it cannot overwrite an edit or unresolved command.
	if (
		serverChanged &&
		draft === (baseline.displayName ?? '') &&
		!command.locked &&
		!command.error
	) {
		setBaseline(initial.branding)
		setDraft(initial.branding.displayName ?? '')
	}
	const preview = normalized ?? null
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (
			locked ||
			invalid ||
			serverChanged ||
			normalized === baseline.displayName
		)
			return
		void command.execute(() => ({
			workspaceId: workspace.workspaceId,
			subject: session!.userId,
			commandId: crypto.randomUUID(),
			expectedVersion: baseline.version,
			displayName: normalized
		}))
	}
	const reload = async () => {
		const result = await context.query.refetch()
		const current = useSessionStore.getState()
		if (
			result.error ||
			!result.data ||
			current.session?.accessToken !== session?.accessToken ||
			current.sessionRevision !== sessionRevision
		)
			return
		setBaseline(result.data.branding)
		setDraft(result.data.branding.displayName ?? '')
		command.reset()
		toast('Актуальное название загружено')
	}

	return (
		<form className={styles.form} onSubmit={submit}>
			<div className={styles.fields}>
				{context.query.isError ? (
					<div className={styles.refreshNotice} role="alert">
						<p>
							Не удалось обновить название. Ваши изменения сохранены в
							форме.
						</p>
						<Button
							variant="secondary"
							onClick={() => void context.query.refetch()}
						>
							Повторить загрузку
						</Button>
					</div>
				) : null}
				{serverChanged && !command.locked ? (
					<p className={styles.notice}>
						Название изменилось в другом окне. Загрузите актуальное
						название перед сохранением.
					</p>
				) : null}
				<TextField
					label="Название компании или бренда"
					value={draft}
					onChange={event => setDraft(event.target.value)}
					disabled={locked}
					autoComplete="organization"
					placeholder="Например, Студия Север"
					hint={
						<span className={styles.hint}>
							<span>
								До {COMPANY_NAME_LIMIT} символов. Очистите поле, чтобы
								убрать подпись.
							</span>
							<span>
								{count}/{COMPANY_NAME_LIMIT}
							</span>
						</span>
					}
					error={
						invalid
							? count > COMPANY_NAME_LIMIT
								? `Сократите название до ${COMPANY_NAME_LIMIT} символов.`
								: 'Используйте обычный текст без HTML и скрытых символов.'
							: undefined
					}
				/>
				{!canWrite ? (
					<p className={styles.notice}>
						{permissions.isError
							? 'Не удалось проверить права на изменение.'
							: workspace.isReadOnly ||
								  permissions.data?.state === 'READ_ONLY'
								? 'В режиме чтения название менять нельзя.'
								: 'Название меняют владелец и администратор CRM.'}
					</p>
				) : null}
				{command.error ? (
					<p className={styles.error} role="alert">
						{command.error.message}
					</p>
				) : null}
				{command.uncertain ? (
					<p className={styles.notice}>
						Результат сохранения пока неизвестен. Повторная проверка
						отправит ту же команду, не создавая новое изменение.
					</p>
				) : null}
				<div className={styles.actions}>
					<Button
						type="submit"
						disabled={
							locked ||
							invalid ||
							serverChanged ||
							normalized === baseline.displayName
						}
					>
						{command.running ? 'Сохраняем…' : 'Сохранить название'}
					</Button>
					{command.uncertain ? (
						<Button
							variant="secondary"
							disabled={!canWrite || command.running}
							onClick={() => void command.execute()}
						>
							Проверить результат
						</Button>
					) : null}
					{blocked || (serverChanged && !command.locked) ? (
						<Button
							variant="secondary"
							disabled={context.query.isFetching || !canWrite}
							onClick={() => void reload()}
						>
							Загрузить актуальное название
						</Button>
					) : null}
				</div>
			</div>
			<div className={styles.preview} aria-label="Предпросмотр подписи">
				<BrandLogo />
				{preview ? (
					<span className={styles.previewName} title={preview}>
						{preview}
					</span>
				) : (
					<span className={styles.notice}>Без подписи</span>
				)}
			</div>
		</form>
	)
}
