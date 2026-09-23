'use client'

import { listIntakeSources, type IntakeSource } from '@/entities/intake'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import {
	Button,
	DataTable,
	Drawer,
	HelpHint,
	ScreenState,
	StatusBadge,
	type DataTableColumn
} from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { sourceWebhookUrl } from '../model/source-credential'
import type { IntakeAccess } from '../model/use-intake-access'
import { SourceEditor } from './SourceEditor'
import { TildaSourceSetup } from './TildaSourceSetup'
import styles from './SourcesPanel.module.scss'

export const SourcesPanel = ({ access }: { access: IntakeAccess }) => {
	const [page, setPage] = useState(1)
	const [selected, setSelected] = useState<{
		operation: 'create' | 'rotate' | 'revoke'
		source?: IntakeSource
		integration?: 'api' | 'tilda'
	} | null>(null)
	const [tildaSourceId, setTildaSourceId] = useState<string | null>(null)
	const query = useQuery({
		queryKey: [
			'crm-intake-sources',
			access.workspaceId,
			access.session?.userId,
			access.revision,
			access.scopeKey,
			page
		],
		enabled: access.sourceManager && !!access.session,
		queryFn: () =>
			listIntakeSources(
				access.session!.accessToken,
				access.workspaceId,
				page
			),
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: false
	})
	const tildaSource =
		query.data?.items.find(item => item.id === tildaSourceId) ?? null
	const denied =
		query.error instanceof AuthenticatedApiError &&
		['unauthorized', 'forbidden'].includes(query.error.kind)
	const copyAddress = async (id: string) => {
		try {
			await navigator.clipboard.writeText(sourceWebhookUrl(id))
			toast.success('Адрес приёма скопирован')
		} catch {
			toast.error('Не удалось скопировать адрес')
		}
	}
	const columns: DataTableColumn<IntakeSource>[] = [
		{
			id: 'name',
			header: 'Источник',
			render: item => (
				<div>
					<strong>{item.name}</strong>
					{item.revokedAt ? (
						<p className={styles.description}>
							Сохранён для истории обращений
						</p>
					) : (
						<code className={styles.url}>{sourceWebhookUrl(item.id)}</code>
					)}
				</div>
			)
		},
		{
			id: 'status',
			header: 'Состояние ключа',
			render: item => (
				<StatusBadge tone={item.revokedAt ? 'neutral' : 'success'}>
					{item.revokedAt
						? 'Отозван'
						: `Действует · версия ${item.tokenVersion}`}
				</StatusBadge>
			)
		},
		{
			id: 'actions',
			header: 'Действия',
			render: item =>
				item.revokedAt ? (
					<span className={styles.description}>Приём отключён</span>
				) : (
					<div className={styles.actions}>
						<Button
							size="sm"
							variant="secondary"
							onClick={() => void copyAddress(item.id)}
						>
							Адрес
						</Button>
						<Button
							size="sm"
							variant="secondary"
							tooltip="Открыть настройки передачи заявок из форм Tilda для этого источника"
							onClick={() => {
								setTildaSourceId(item.id)
								toast('Открыта настройка Tilda для источника')
							}}
						>
							Tilda
						</Button>
						<Button
							size="sm"
							variant="secondary"
							tooltip="Выпустить новый ключ. Прежний ключ перестанет принимать новые заявки; история обращений сохранится."
							disabled={!access.canManageSources || query.isFetching}
							onClick={() =>
								setSelected({ operation: 'rotate', source: item })
							}
						>
							Заменить ключ
						</Button>
						<Button
							size="sm"
							variant="danger"
							tooltip="Остановить приём новых заявок через этот источник. Уже полученные обращения сохранятся."
							disabled={!access.canManageSources || query.isFetching}
							onClick={() =>
								setSelected({ operation: 'revoke', source: item })
							}
						>
							Отозвать
						</Button>
					</div>
				)
		}
	]
	return (
		<div className={styles.panel}>
			<div className={styles.header}>
				<div>
					<h2 className={styles.title}>API-источники и формы</h2>
					<HelpHint
						label="Источники обращений"
						description="Источник выдаёт отдельный ключ для приёма заявок из Tilda, сайта или API. Замена ключа отключит прежний ключ; уже принятые обращения останутся в истории."
					/>
					<p className={styles.description}>
						Подключайте формы Tilda, серверные формы и внешние системы.
						Секретные ключи никогда не показываются в списке.
					</p>
				</div>
				<div className={styles.actions}>
					<Button
						variant="secondary"
						disabled={!access.canManageSources || denied}
						onClick={() => {
							setSelected({ operation: 'create', integration: 'tilda' })
							toast('Создайте источник для форм Tilda')
						}}
					>
						Подключить Tilda
					</Button>
					<Button
						disabled={!access.canManageSources || denied}
						onClick={() => setSelected({ operation: 'create' })}
					>
						Новый источник
					</Button>
				</div>
			</div>
			{!access.permissions.isSuccess ? (
				<ScreenState
					variant={access.permissions.isError ? 'error' : 'loading'}
					description={access.permissions.error?.message}
					action={
						access.permissions.isError ? (
							<Button onClick={() => void access.permissions.refetch()}>
								Проверить доступ
							</Button>
						) : undefined
					}
				/>
			) : !access.sourceManager || denied ? (
				<ScreenState
					variant="permission"
					description="Метаданные и настройки источников доступны только владельцу рабочего пространства и CRM-администратору."
				/>
			) : query.isError ? (
				<ScreenState
					variant="error"
					description={query.error.message}
					action={
						<Button onClick={() => void query.refetch()}>Повторить</Button>
					}
				/>
			) : query.isPending || query.isFetching ? (
				<ScreenState variant="loading" />
			) : (
				<>
					<DataTable
						caption="API-источники рабочего пространства"
						columns={columns}
						rows={query.data.items}
						getRowKey={item => item.id}
						emptyMessage="Источники ещё не созданы"
					/>
					<div className={styles.pagination}>
						<Button
							variant="secondary"
							disabled={page === 1}
							onClick={() => setPage(value => value - 1)}
						>
							Назад
						</Button>
						<span>
							{page} / {Math.max(1, Math.ceil(query.data.total / 25))}
						</span>
						<Button
							variant="secondary"
							disabled={page * 25 >= query.data.total}
							onClick={() => setPage(value => value + 1)}
						>
							Далее
						</Button>
					</div>
				</>
			)}
			<section
				className={styles.documentation}
				aria-label="Подключение по API"
			>
				<h3>Как отправить обращение</h3>
				<p>
					Отправьте POST на адрес выбранного источника. Ключ передавайте
					только в <code>Authorization: Bearer &lt;ключ&gt;</code>, а
					UUIDv4 события — в <code>Idempotency-Key</code>. При повторе
					используйте прежние UUID и тело.
				</p>
				<pre className={styles.code}>
					{JSON.stringify(
						{
							schemaVersion: 1,
							title: 'Заявка с формы',
							name: 'Клиент',
							phone: '+79001234567',
							email: 'client@example.test',
							message: 'Прошу связаться со мной'
						},
						null,
						2
					)}
				</pre>
				<p>
					Не передавайте workspace, сотрудника, команду или contact/deal
					IDs: они определяются сервером. Успешный ответ содержит{' '}
					<code>schemaVersion, entryId, receivedAt</code>. Наличие
					настроенного ключа не подтверждает доставку; проверьте ответ API
					и появление обращения во «Входящих».
				</p>
				<p>
					При потере ключа выполните ротацию и обновите секрет на
					отправляющем сервере. Не храните ключ в URL, браузерном коде,
					аналитике или открытых логах.
				</p>
			</section>

			{tildaSource &&
			access.session &&
			access.sourceManager &&
			!denied &&
			tildaSource.workspaceId === access.workspaceId ? (
				<Drawer
					isOpen
					title="Подключение Tilda"
					onClose={() => setTildaSourceId(null)}
				>
					<div className={styles.documentation}>
						<p>
							Источник: <strong>{tildaSource.name}</strong>
						</p>
						{tildaSource.revokedAt ? (
							<p>
								Источник отозван и не принимает новые обращения. Для
								подключения формы создайте новый источник.
							</p>
						) : (
							<>
								<TildaSourceSetup sourceId={tildaSource.id} />
								<Button
									variant="secondary"
									disabled={!access.canManageSources || query.isFetching}
									onClick={() => {
										setSelected({
											operation: 'rotate',
											source: tildaSource,
											integration: 'tilda'
										})
										setTildaSourceId(null)
										toast(
											'Подтвердите замену ключа перед обновлением в Tilda'
										)
									}}
								>
									Заменить ключ для Tilda
								</Button>
							</>
						)}
					</div>
				</Drawer>
			) : null}
			{selected && access.session ? (
				<SourceEditor
					key={`${access.workspaceId}:${access.session?.userId}:${selected.operation}:${selected.source?.id ?? 'new'}:${selected.integration ?? 'api'}`}
					{...selected}
					access={access}
					onClose={() => setSelected(null)}
					onSaved={() => void query.refetch()}
				/>
			) : null}
		</div>
	)
}
