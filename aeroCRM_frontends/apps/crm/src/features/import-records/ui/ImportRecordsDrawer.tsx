'use client'

import {
	crmPermissionScope,
	getCrmPermissions
} from '@/entities/crm-access'
import {
	applyCrmImport,
	getCrmImport,
	inspectCrmImport,
	previewCrmImport
} from '@/entities/crm-import/api/import.api'
import type {
	ImportDecision,
	ImportEntity,
	ImportPreview,
	ImportResult,
	ImportSheet
} from '@/entities/crm-import/model/import.contract'
import { listSalesPipelines } from '@/entities/sales'
import {
	useSessionStore,
	type AuthenticatedSession
} from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import { useDirtyForm } from '@/shared/lib/dirty-form'
import {
	Button,
	Drawer,
	ScreenState,
	SelectField,
	TextField
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ChangeEvent
} from 'react'
import {
	importFields,
	importLabels,
	importTemplates,
	suggestImportMapping
} from '../model/import-fields'
import styles from './ImportRecords.module.scss'

type Marker = { previewId: string; commandId: string }
const readMarker = (key: string): Marker | null => {
	const text = window.localStorage.getItem(key)
	if (!text) return null
	const value: unknown = JSON.parse(text)
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== 2 ||
		!('previewId' in value) ||
		!('commandId' in value) ||
		!isUuidV4(value.previewId) ||
		!isUuidV4(value.commandId)
	)
		throw new Error(
			'Не удалось прочитать квитанцию импорта. Не начинайте повторный импорт до восстановления результата.'
		)
	return { previewId: value.previewId, commandId: value.commandId }
}
const message = (error: unknown) =>
	error instanceof Error ? error.message : 'Не удалось выполнить импорт.'
const readFile = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader()
		reader.onerror = () => reject(new Error('Не удалось прочитать файл.'))
		reader.onload = () =>
			typeof reader.result === 'string'
				? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
				: reject(new Error('Не удалось прочитать файл.'))
		reader.readAsDataURL(file)
	})
const download = (body: string, filename: string, type: string) => {
	const url = URL.createObjectURL(new Blob([body], { type }))
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = filename
	anchor.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const actionLabels = {
	CREATE: 'Создать',
	LINK: 'Связать с существующей',
	SKIP: 'Пропустить',
	ERROR: 'Ошибка'
}

export const ImportRecordsDrawer = ({
	entity,
	workspaceId,
	session,
	revision,
	scope,
	canWrite,
	onClose
}: {
	entity: ImportEntity
	workspaceId: string
	session: AuthenticatedSession
	revision: number
	scope: string
	canWrite: boolean
	onClose: () => void
}) => {
	const client = useQueryClient()
	const storageKey = `crm:import-receipt:v1:${workspaceId}:${session.userId}:${entity}`
	const [initialMarker] = useState(() => {
		try {
			return { marker: readMarker(storageKey), error: null }
		} catch (error) {
			return { marker: null, error: message(error) }
		}
	})
	const [pending, setPending] = useState<Marker | null>(
		initialMarker.marker
	)
	const [storageError, setStorageError] = useState(initialMarker.error)
	const [file, setFile] = useState<{
		filename: string
		contentBase64: string
	} | null>(null)
	const [sheets, setSheets] = useState<ImportSheet[]>([])
	const [sheetName, setSheetName] = useState('')
	const [sourceKey, setSourceKey] = useState('')
	const [mapping, setMapping] = useState<Record<string, string>>({})
	const [pipelineId, setPipelineId] = useState('')
	const [stageId, setStageId] = useState('')
	const [stageMapping, setStageMapping] = useState<Record<string, string>>(
		{}
	)
	const [stageDraft, setStageDraft] = useState('')
	const [decisions, setDecisions] = useState<ImportDecision[]>([])
	const [preview, setPreview] = useState<ImportPreview | null>(null)
	const [result, setResult] = useState<ImportResult | null>(null)
	const [stale, setStale] = useState(true)
	const [acknowledged, setAcknowledged] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [page, setPage] = useState(0)
	const mounted = useRef(false)
	const operation = useRef(false)
	const guard = useDirtyForm({
		dirty: !!file && !result && !pending,
		label: `Импорт ${importLabels[entity]}`
	})
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	useEffect(() => {
		const listener = (event: StorageEvent) => {
			if (event.key !== storageKey) return
			try {
				const next = readMarker(storageKey)
				if (next) setPending(next)
				setStorageError(null)
			} catch (cause) {
				setStorageError(message(cause))
			}
		}
		window.addEventListener('storage', listener)
		return () => window.removeEventListener('storage', listener)
	}, [storageKey])
	const current = () => {
		const state = useSessionStore.getState()
		return (
			mounted.current &&
			state.sessionRevision === revision &&
			state.session?.userId === session.userId &&
			state.session?.accessToken === session.accessToken
		)
	}
	const authorize = async (write = true) => {
		if (!current() || (write && !canWrite) || !navigator.onLine)
			throw new Error('Проверьте доступ и подключение к сети.')
		const permissions = await getCrmPermissions(
			session.accessToken,
			workspaceId
		)
		if (!current())
			throw new Error('Сессия изменилась. Откройте импорт заново.')
		const key = ['crm-permissions', workspaceId, session.userId, revision]
		await client.cancelQueries({ queryKey: key, exact: true })
		if (!current())
			throw new Error('Сессия изменилась. Откройте импорт заново.')
		client.setQueryData(key, permissions)
		const area = entity === 'deals' ? 'sales' : 'customers'
		if (
			permissions.subject !== session.userId ||
			crmPermissionScope(permissions) !== scope ||
			(write &&
				(permissions.state === 'READ_ONLY' ||
					!permissions.permissions.includes(`${area}:write`))) ||
			!permissions.permissions.includes(`${area}:read`) ||
			(entity === 'deals' &&
				!permissions.permissions.includes('customers:read'))
		)
			throw new Error(
				'Права изменились. Откройте импорт заново для проверки доступа.'
			)
		return session.accessToken
	}
	const run = async (action: () => Promise<void>) => {
		if (operation.current || !current()) return
		operation.current = true
		setBusy(true)
		setError(null)
		try {
			await action()
		} catch (cause) {
			if (current()) setError(message(cause))
		} finally {
			operation.current = false
			if (current()) setBusy(false)
		}
	}
	const pipelines = useQuery({
		queryKey: [
			'sales',
			'pipelines',
			workspaceId,
			session.userId,
			revision,
			scope
		],
		enabled: entity === 'deals' && canWrite,
		queryFn: () => listSalesPipelines(session.accessToken, workspaceId),
		retry: false,
		gcTime: 0
	})
	const sheet = sheets.find(item => item.name === sheetName)
	const stages =
		pipelines.data?.find(item => item.id === pipelineId)?.stages ?? []
	const locked =
		busy || !!pending || !!result || !!storageError || !canWrite
	const unmapped =
		sheet?.headers.filter(
			header => !Object.values(mapping).includes(header)
		) ?? []
	const mappingValid =
		entity === 'companies'
			? !!mapping.name
			: entity === 'contacts'
				? !!(mapping.name || mapping.firstName || mapping.lastName)
				: !!(
						mapping.externalId &&
						mapping.title &&
						!!mapping.contactId !== !!mapping.contactExternalId
					)
	const valueLabel = (key: string) =>
		importFields[entity].find(item => item.key === key)?.label ||
		(
			{
				responsible: 'Ответственный',
				sourceId: 'Исходный ID',
				pipelineId: 'ID воронки',
				resolvedStageId: 'ID этапа',
				resolvedPipelineName: 'Воронка',
				resolvedStageName: 'Этап aeroCRM',
				resolvedContactName: 'Связанный контакт',
				companyName: 'Связанная компания',
				unmappedColumns: 'Несопоставленные столбцы'
			} as Record<string, string>
		)[key] ||
		key.replace(/^source:/, 'Исходное поле: ')
	const change = () => {
		setStale(true)
		setAcknowledged(false)
	}
	const stageValues = [
		...new Set([
			...Object.keys(stageMapping),
			...(preview?.rows
				.map(row => row.values.stageKey || row.values.stageName || '')
				.filter(Boolean) ?? [])
		])
	]
	const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
		const selected = event.currentTarget.files?.[0]
		event.currentTarget.value = ''
		if (!selected || locked) return
		void run(async () => {
			if (!/\.(csv|xlsx)$/i.test(selected.name))
				throw new Error(
					'Выберите CSV или Excel XLSX. Старый XLS сначала сохраните как XLSX или CSV.'
				)
			if (!selected.size || selected.size > 1_000_000)
				throw new Error('Выберите непустой файл размером до 1 МБ.')
			const token = await authorize()
			const input = {
				filename: selected.name,
				contentBase64: await readFile(selected)
			}
			if (!current()) return
			const response = await inspectCrmImport(token, {
				schemaVersion: 1,
				workspaceId,
				entity,
				...input
			})
			if (!current()) return
			setFile(input)
			setSheets(response.sheets)
			setSheetName(response.sheets[0]?.name || '')
			setMapping(
				suggestImportMapping(entity, response.sheets[0]?.headers || [])
			)
			setPreview(null)
			setDecisions([])
			setStageMapping({})
			change()
		})
	}
	const prepare = () => {
		if (!file || !sheet || locked) return
		void run(async () => {
			const token = await authorize()
			const response = await previewCrmImport(token, {
				schemaVersion: 1,
				workspaceId,
				entity,
				...file,
				sourceKey: sourceKey.trim(),
				sheet: sheet.name,
				mapping: Object.fromEntries(
					Object.entries(mapping).filter(([, value]) => value)
				),
				options:
					entity === 'deals'
						? {
								pipelineId,
								...(stageId ? { stageId } : {}),
								...(Object.values(stageMapping).some(Boolean)
									? {
											stageMapping: Object.fromEntries(
												Object.entries(stageMapping).filter(
													([, value]) => value
												)
											)
										}
									: {})
							}
						: {},
				decisions
			})
			if (!current()) return
			setPreview(response)
			setStale(false)
			setPage(0)
			setAcknowledged(false)
		})
	}
	const withMarkerLock = async <T,>(
		action: () => T | Promise<T>
	): Promise<T> => {
		if (!navigator.locks)
			throw new Error(
				'Браузер не поддерживает безопасное восстановление импорта. Откройте CRM в актуальном браузере.'
			)
		return navigator.locks.request(
			storageKey,
			{ mode: 'exclusive' },
			action
		)
	}
	const clearMarker = (commandId: string) =>
		withMarkerLock(() => {
			if (readMarker(storageKey)?.commandId === commandId)
				window.localStorage.removeItem(storageKey)
		})
	const complete = async (output: ImportResult) => {
		if (!current()) return
		setResult(output)
		setFile(null)
		setPending(null)
		try {
			await clearMarker(output.commandId)
		} catch {
			/* The stored receipt remains recoverable; no new command is issued. */
		}
		void client.invalidateQueries({
			queryKey: ['crm-customers', workspaceId]
		})
		void client.invalidateQueries({ queryKey: ['sales'] })
	}
	const sendMarker = async (token: string, marker: Marker) => {
		try {
			await complete(
				await applyCrmImport(token, entity, {
					schemaVersion: 1,
					workspaceId,
					...marker
				})
			)
		} catch (cause) {
			if (
				current() &&
				cause instanceof AuthenticatedApiError &&
				['validation', 'conflict'].includes(cause.kind)
			) {
				// A definite transaction rejection permits review only after checking its receipt.
				const stored = await getCrmImport(
					token,
					entity,
					workspaceId,
					marker.previewId
				)
				if (!current()) return
				if (stored.result) {
					await complete(stored.result)
					return
				}
				await clearMarker(marker.commandId)
				setPending(null)
				setPreview(stored)
				setSourceKey(stored.sourceKey)
				setStale(true)
				setAcknowledged(false)
			}
			throw cause
		}
	}
	const recover = (retry: boolean) =>
		void run(async () => {
			const marker = pending || readMarker(storageKey)
			if (!marker) return
			const token = await authorize(retry)
			const stored = await getCrmImport(
				token,
				entity,
				workspaceId,
				marker.previewId
			)
			if (!current()) return
			if (stored.result) {
				await complete(stored.result)
				return
			}
			setPreview(stored)
			setSourceKey(stored.sourceKey)
			if (retry) await sendMarker(token, marker)
			else
				setError(
					'Завершение пока не подтверждено. Можно повторить сохранённый запрос: его идентификатор останется прежним.'
				)
		})
	const apply = () => {
		if (
			!preview ||
			stale ||
			preview.summary.error ||
			!acknowledged ||
			locked
		)
			return
		void run(async () => {
			const token = await authorize()
			let marker: Marker
			try {
				marker = await withMarkerLock(() => {
					if (!current())
						throw new Error('Сессия изменилась. Откройте импорт заново.')
					const existing = readMarker(storageKey)
					if (existing) {
						setPending(existing)
						throw new Error(
							'Обнаружен незавершённый импорт. Сначала восстановите его результат.'
						)
					}
					const next = {
						previewId: preview.previewId,
						commandId: crypto.randomUUID()
					}
					window.localStorage.setItem(storageKey, JSON.stringify(next))
					if (readMarker(storageKey)?.commandId !== next.commandId)
						throw new Error('Не удалось сохранить квитанцию импорта.')
					return next
				})
			} catch (cause) {
				throw new Error(
					`Не удалось подготовить квитанцию для восстановления. ${message(cause)}`
				)
			}
			setPending(marker)
			await sendMarker(token, marker)
		})
	}
	const decide = (row: number, value: string) => {
		const candidate = preview?.rows
			.find(item => item.row === row)
			?.candidates.find(item => item.id === value)
		setDecisions(previous => [
			...previous.filter(item => item.row !== row),
			...(value === 'SKIP'
				? [{ row, action: 'SKIP' as const }]
				: candidate
					? [
							{
								row,
								action: 'LINK' as const,
								existingId: candidate.id,
								expectedVersion: candidate.version
							}
						]
					: [])
		])
		change()
	}
	return (
		<Drawer
			isOpen
			size="lg"
			title={`Импорт ${importLabels[entity]}`}
			description="CSV или Excel XLSX · до 1 МБ и 500 строк"
			dirtyFormIds={[guard.id]}
			onClose={() => {
				if (!busy) onClose()
			}}
		>
			<div className={styles.stack}>
				<p className={styles.notice}>
					Все выбранные строки сохраняются вместе. При ошибке весь пакет
					откатывается. Компании → контакты → сделки импортируются
					отдельными файлами в таком порядке.
				</p>
				{storageError && (
					<p className={styles.error} role="alert">
						{storageError}
					</p>
				)}
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				{!canWrite && (
					<p className={styles.error}>
						Сейчас импорт недоступен: проверьте права и состояние рабочего
						пространства.
					</p>
				)}
				{busy && (
					<ScreenState
						variant="loading"
						compact
						title="Проверяем импорт"
					/>
				)}
				{pending && !result && (
					<section
						className={styles.section}
						aria-label="Восстановление импорта"
					>
						<h3>Сохранённый запрос</h3>
						<p>
							Результат ещё не подтверждён. Файл повторно загружать не
							нужно. Закрытие окна сохранит квитанцию для восстановления.
						</p>
						<div className={styles.actions}>
							<Button disabled={busy} onClick={() => recover(false)}>
								Проверить результат
							</Button>
							<Button
								variant="secondary"
								disabled={busy || !canWrite}
								onClick={() => recover(true)}
							>
								Повторить тот же запрос
							</Button>
						</div>
					</section>
				)}
				{result ? (
					<section
						className={styles.section}
						aria-label="Результат импорта"
					>
						<h3>Импорт завершён</h3>
						<p>
							Создано: {result.created}. Связано с существующими:{' '}
							{result.linked}. Пропущено: {result.skipped}.
						</p>
						<p className={styles.muted}>
							Существующие записи при связывании не изменялись.
						</p>
						<div className={styles.actions}>
							<Button
								variant="secondary"
								onClick={() =>
									download(
										JSON.stringify(result, null, 2),
										`aerocrm-import-${entity}-${result.previewId}.json`,
										'application/json'
									)
								}
							>
								Скачать отчёт
							</Button>
							<Button onClick={onClose}>Закрыть</Button>
						</div>
					</section>
				) : (
					!pending && (
						<>
							<section className={styles.section}>
								<h3>1. Выберите файл и источник</h3>
								<p className={styles.muted}>
									Для Google Контактов экспортируйте Google CSV. Для другой
									CRM выгрузите нужные поля и ID записей. Старый формат XLS
									сохраните как XLSX или CSV UTF-8.
								</p>
								<Button
									variant="secondary"
									disabled={locked}
									onClick={() =>
										download(
											`\uFEFF${importTemplates[entity]}`,
											`aerocrm-${entity}-template.csv`,
											'text/csv;charset=utf-8'
										)
									}
								>
									Скачать шаблон CSV
								</Button>
								<TextField
									label="Источник переноса"
									value={sourceKey}
									maxLength={100}
									placeholder="Например: bitrix-main или google-personal"
									hint="Используйте одно и то же название для повторов и связанных файлов компаний, контактов и сделок."
									disabled={locked}
									onChange={event => {
										setSourceKey(event.target.value)
										change()
									}}
								/>
								<label className={styles.stack}>
									<span>Файл {importLabels[entity]}</span>
									<input
										className={styles.file}
										type="file"
										accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
										disabled={locked}
										onChange={chooseFile}
									/>
								</label>
								<p className={styles.muted}>
									Импортируются поля карточек и связи. История действий,
									вложения и произвольные поля не переносятся.
									Ответственным за новые записи будете вы; исходные
									назначения не переносятся.
								</p>
							</section>
							{file && sheet && (
								<section className={styles.section}>
									<h3>2. Сопоставьте столбцы</h3>
									<p>
										{file.filename} · строк: {sheet.rowCount}
									</p>
									{sheets.length > 1 && (
										<SelectField
											label="Лист для импорта"
											value={sheetName}
											disabled={locked}
											hint="Одним пакетом импортируется выбранный лист. Остальные листы не загружаются."
											onChange={event => {
												const next = sheets.find(
													item => item.name === event.target.value
												)!
												setSheetName(next.name)
												setMapping(
													suggestImportMapping(entity, next.headers)
												)
												setDecisions([])
												setPreview(null)
												change()
											}}
										>
											{sheets.map(item => (
												<option key={item.name} value={item.name}>
													{item.name} ({item.rowCount})
												</option>
											))}
										</SelectField>
									)}
									<div className={styles.grid}>
										{importFields[entity].map(item => (
											<SelectField
												key={item.key}
												label={item.label}
												value={mapping[item.key] || ''}
												disabled={locked}
												onChange={event => {
													setMapping(previous => ({
														...previous,
														[item.key]: event.target.value
													}))
													setDecisions([])
													change()
												}}
											>
												<option value="">Не сопоставлять</option>
												{sheet.headers.map(header => (
													<option key={header} value={header}>
														{header}
													</option>
												))}
											</SelectField>
										))}
									</div>
									{entity === 'deals' && (
										<>
											<SelectField
												label="Воронка для сделок"
												value={pipelineId}
												disabled={locked || pipelines.isFetching}
												onChange={event => {
													setPipelineId(event.target.value)
													setStageId('')
													setStageMapping({})
													change()
												}}
											>
												<option value="">Выберите воронку</option>
												{pipelines.data?.map(item => (
													<option key={item.id} value={item.id}>
														{item.name}
													</option>
												))}
											</SelectField>
											{pipelines.isError && (
												<p className={styles.error}>
													Не удалось загрузить воронки.{' '}
													<Button
														variant="secondary"
														onClick={() => void pipelines.refetch()}
													>
														Повторить
													</Button>
												</p>
											)}
											<SelectField
												label="Этап для файла без столбца этапов"
												value={stageId}
												disabled={locked || !pipelineId}
												onChange={event => {
													setStageId(event.target.value)
													change()
												}}
											>
												<option value="">
													Сопоставить этапы из файла
												</option>
												{stages.map(item => (
													<option key={item.id} value={item.id}>
														{item.name} ({item.state})
													</option>
												))}
											</SelectField>
											<p className={styles.muted}>
												Контакт обязателен. Сумма — в основных единицах
												валюты (например, 5000 рублей). Дата создания —
												ISO, например 2026-10-01T09:00:00Z. Следующие
												задачи автоматически не создаются.
											</p>
											<div className={styles.actions}>
												<TextField
													label="Значение этапа из файла"
													value={stageDraft}
													disabled={locked}
													onChange={event =>
														setStageDraft(event.target.value)
													}
												/>
												<Button
													variant="secondary"
													disabled={locked || !stageDraft.trim()}
													onClick={() => {
														setStageMapping(previous => ({
															...previous,
															[stageDraft.trim()]:
																previous[stageDraft.trim()] || ''
														}))
														setStageDraft('')
														change()
													}}
												>
													Добавить сопоставление этапа
												</Button>
											</div>
											{stageValues.map(value => (
												<SelectField
													key={value}
													label={`Этап «${value}» →`}
													value={stageMapping[value] || ''}
													disabled={locked}
													onChange={event => {
														setStageMapping(previous => ({
															...previous,
															[value]: event.target.value
														}))
														change()
													}}
												>
													<option value="">Выберите этап aeroCRM</option>
													{stages.map(item => (
														<option key={item.id} value={item.id}>
															{item.name} ({item.state})
														</option>
													))}
												</SelectField>
											))}
										</>
									)}
									{unmapped.length > 0 && (
										<p className={styles.notice}>
											Не сопоставлены: {unmapped.join(', ')}.{' '}
											{entity === 'contacts'
												? 'Эти данные сохранятся в заметках контакта.'
												: 'Эти столбцы не переносятся.'}{' '}
											Проверьте предупреждения строк.
										</p>
									)}
									<details>
										<summary>Пример исходных строк</summary>
										<div className={styles.tableWrap} tabIndex={0}>
											<table>
												<thead>
													<tr>
														{sheet.headers.map(header => (
															<th key={header}>{header}</th>
														))}
													</tr>
												</thead>
												<tbody>
													{sheet.sample.map((row, index) => (
														<tr key={index}>
															{sheet.headers.map(header => (
																<td key={header}>{row[header]}</td>
															))}
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</details>
									{!mappingValid && (
										<p className={styles.notice}>
											{entity === 'deals'
												? 'Сопоставьте внешний ID, название сделки и один ID контакта.'
												: entity === 'companies'
													? 'Сопоставьте название компании.'
													: 'Сопоставьте полное имя или отдельные имя и фамилию.'}
										</p>
									)}
									<Button
										disabled={
											locked ||
											!sourceKey.trim() ||
											!mappingValid ||
											(entity === 'deals' && !pipelineId)
										}
										onClick={prepare}
									>
										Проверить весь файл
									</Button>
								</section>
							)}
							{preview && (
								<section
									className={styles.section}
									aria-label="Предпросмотр импорта"
								>
									<h3>3. Проверьте и подтвердите</h3>
									<p>
										Создать: {preview.summary.create}. Связать:{' '}
										{preview.summary.link}. Пропустить:{' '}
										{preview.summary.skip}. Ошибок: {preview.summary.error}
										.
									</p>
									<p className={styles.muted}>
										Предпросмотр действует до{' '}
										{new Date(preview.expiresAt).toLocaleString('ru-RU')}.
										Связывание сохраняет существующую карточку без
										изменений.
									</p>
									{stale && (
										<p className={styles.notice}>
											Настройки изменились. Снова нажмите «Проверить весь
											файл».
										</p>
									)}
									{preview.summary.error > 0 && (
										<p className={styles.error}>
											Ошибки блокируют весь пакет. Исправьте файл или явно
											пропустите строки, затем повторите проверку.
										</p>
									)}
									<div className={styles.tableWrap} tabIndex={0}>
										<table>
											<thead>
												<tr>
													<th>Строка / ID</th>
													<th>Данные</th>
													<th>Действие и проверка</th>
													<th>Решение</th>
												</tr>
											</thead>
											<tbody>
												{preview.rows
													.slice(page * 25, (page + 1) * 25)
													.map(row => (
														<tr key={row.row}>
															<td>
																{row.row}
																<br />
																{row.sourceId}
															</td>
															<td>
																<strong>
																	{row.values.name ||
																		row.values.title ||
																		'—'}
																</strong>
																<details>
																	<summary>Все поля</summary>
																	{Object.entries(row.values).map(
																		([key, value]) => (
																			<p key={key}>
																				{valueLabel(key)}:{' '}
																				{key === 'responsible' &&
																				value === session.userId
																					? 'Вы'
																					: value || '—'}
																			</p>
																		)
																	)}
																</details>
															</td>
															<td>
																{actionLabels[row.action]}
																{row.errors.map((item, index) => (
																	<p
																		key={`e${index}`}
																		className={styles.error}
																	>
																		{item}
																	</p>
																))}
																{row.warnings.map((item, index) => (
																	<p
																		key={`w${index}`}
																		className={styles.muted}
																	>
																		{item}
																	</p>
																))}
															</td>
															<td>
																<SelectField
																	label={`Решение для строки ${row.row}`}
																	value={
																		decisions.find(
																			item => item.row === row.row
																		)?.action === 'SKIP'
																			? 'SKIP'
																			: decisions.find(
																					item => item.row === row.row
																				)?.existingId || ''
																	}
																	disabled={locked}
																	onChange={event =>
																		decide(row.row, event.target.value)
																	}
																>
																	<option value="">
																		По результату проверки
																	</option>
																	<option value="SKIP">
																		Пропустить строку
																	</option>
																	{row.candidates.map(candidate => (
																		<option
																			key={candidate.id}
																			value={candidate.id}
																		>
																			Связать: {candidate.name}
																		</option>
																	))}
																</SelectField>
															</td>
														</tr>
													))}
											</tbody>
										</table>
									</div>
									<div className={styles.actions}>
										<Button
											variant="secondary"
											disabled={page === 0}
											onClick={() => setPage(value => value - 1)}
										>
											Назад
										</Button>
										<span>
											Страница {page + 1} из{' '}
											{Math.max(1, Math.ceil(preview.rows.length / 25))}
										</span>
										<Button
											variant="secondary"
											disabled={(page + 1) * 25 >= preview.rows.length}
											onClick={() => setPage(value => value + 1)}
										>
											Далее
										</Button>
										<Button
											variant="secondary"
											onClick={() =>
												download(
													JSON.stringify(preview, null, 2),
													`aerocrm-import-preview-${entity}.json`,
													'application/json'
												)
											}
										>
											Скачать проверку
										</Button>
									</div>
									<label className={styles.check}>
										<input
											type="checkbox"
											checked={acknowledged}
											disabled={
												locked || stale || preview.summary.error > 0
											}
											onChange={event =>
												setAcknowledged(event.target.checked)
											}
										/>
										<span>
											Я проверил строки, пропуски, связи и предупреждения.
											Подтверждаю импорт выбранных данных одним пакетом.
										</span>
									</label>
									<Button
										disabled={
											locked ||
											stale ||
											!acknowledged ||
											preview.summary.error > 0
										}
										onClick={apply}
									>
										Импортировать весь пакет
									</Button>
								</section>
							)}
						</>
					)
				)}
			</div>
		</Drawer>
	)
}
