'use client'

import {
	inspectCatalogImport,
	previewCatalogImport,
	applyCatalogImport
} from '@/entities/sales/api/commerce.api'
import { useSessionStore } from '@/entities/session'
import { Button, Drawer, ScreenState, SelectField } from '@/shared/ui'
import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import toast from 'react-hot-toast'
import {
	useCommerceCommand,
	type CommerceContext
} from '../model/use-commerce-command'
import {
	commerceFormError,
	downloadCommerceBlob
} from '../model/commerce-form'
import { salesMoney } from './DealDetailsDrawer'
import { CommerceCommandState } from './CommerceCommandState'
import styles from './Commerce.module.scss'

type FileInput = { filename: string; contentBase64: string }
type ImportSheet = {
	name: string
	headers: string[]
	rowCount: number
	sample: Record<string, string>[]
}
type Mapping = {
	code: string
	kind: string
	name: string
	unit: string
	basePriceMinor: string
}
type Preview = {
	previewId: string
	expiresAt: string
	rows: Array<{
		row: number
		code: string
		kind: string
		name: string
		unit: string
		basePriceMinor: number | null
		action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR'
		errors: string[]
		expectedVersion: number | null
	}>
	summary: {
		created: number
		updated: number
		unchanged: number
		errors: number
	}
}
const mappingFields: Array<{
	key: keyof Mapping
	label: string
	aliases: string[]
}> = [
	{
		key: 'code',
		label: 'Код / артикул',
		aliases: ['код', 'артикул', 'код / артикул', 'code', 'sku']
	},
	{ key: 'kind', label: 'Тип', aliases: ['тип', 'kind', 'type'] },
	{
		key: 'name',
		label: 'Название',
		aliases: ['название', 'наименование', 'name']
	},
	{
		key: 'unit',
		label: 'Единица',
		aliases: ['единица', 'единица измерения', 'ед.', 'unit']
	},
	{
		key: 'basePriceMinor',
		label: 'Базовая цена, ₽',
		aliases: [
			'базовая цена',
			'базовая цена, ₽',
			'цена',
			'цена, ₽',
			'price'
		]
	}
]
const mapHeaders = (headers: string[]): Mapping =>
	Object.fromEntries(
		mappingFields.map(field => [
			field.key,
			headers.find(header =>
				field.aliases.includes(header.trim().toLowerCase())
			) || ''
		])
	) as Mapping
const actionLabels = {
	CREATE: 'Создать',
	UPDATE: 'Обновить',
	UNCHANGED: 'Без изменений',
	ERROR: 'Ошибка'
}
const readBase64 = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader()
		reader.onerror = () => reject(new Error('Не удалось прочитать файл.'))
		reader.onload = () =>
			typeof reader.result === 'string'
				? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
				: reject(new Error('Не удалось прочитать файл.'))
		reader.readAsDataURL(file)
	})

export const CatalogImportDrawer = ({
	context,
	onClose,
	onSaved
}: {
	context: CommerceContext
	onClose: () => void
	onSaved: () => void
}) => {
	const [file, setFile] = useState<FileInput | null>(null)
	const [sheets, setSheets] = useState<ImportSheet[]>([])
	const [sheetName, setSheetName] = useState('')
	const [mapping, setMapping] = useState<Mapping>(() => mapHeaders([]))
	const [preview, setPreview] = useState<Preview | null>(null)
	const [result, setResult] = useState<{
		created: number
		updated: number
		unchanged: number
	} | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const sequence = useRef(0)
	const live = useRef(false)
	useLayoutEffect(() => {
		const trackedSequence = sequence
		live.current = true
		return () => {
			live.current = false
			trackedSequence.current++
		}
	}, [])
	const current = () => {
		const session = useSessionStore.getState()
		return (
			live.current &&
			session.sessionRevision === context.sessionRevision &&
			session.session?.accessToken === context.session?.accessToken
		)
	}
	const command = useCommerceCommand<
		{ previewId: string },
		{
			schemaVersion: 1
			previewId: string
			created: number
			updated: number
			unchanged: number
		}
	>(
		context,
		'catalog:import',
		(token, input) => applyCatalogImport(token, input),
		output => {
			setResult(output)
			setPreview(null)
			setFile(null)
			onSaved()
		}
	)
	const locked = command.locked || busy || !!result
	const sheet = sheets.find(item => item.name === sheetName)
	const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const selected = event.currentTarget.files?.[0]
		event.currentTarget.value = ''
		if (!selected || locked || !current()) return
		const version = ++sequence.current
		setBusy(true)
		setError(null)
		setPreview(null)
		setSheets([])
		setFile(null)
		try {
			if (!/\.(csv|xlsx)$/i.test(selected.name))
				throw new Error('Выберите файл Excel XLSX или CSV.')
			if (selected.size > 1_000_000)
				throw new Error(
					'Файл больше 1 МБ. Разделите каталог на несколько файлов.'
				)
			const input = {
				filename: selected.name,
				contentBase64: await readBase64(selected)
			}
			if (!current() || version !== sequence.current) return
			const inspected = await inspectCatalogImport(
				context.session!.accessToken,
				{ workspaceId: context.workspace.workspaceId, ...input }
			)
			if (!current() || version !== sequence.current) return
			setFile(input)
			setSheets(inspected.sheets)
			setSheetName(inspected.sheets[0]?.name || '')
			setMapping(mapHeaders(inspected.sheets[0]?.headers || []))
		} catch (cause) {
			if (current() && version === sequence.current)
				setError(commerceFormError(cause))
		} finally {
			if (current() && version === sequence.current) setBusy(false)
		}
	}
	const prepare = async () => {
		if (!file || !sheet || locked || !current()) return
		const version = ++sequence.current
		setBusy(true)
		setError(null)
		setPreview(null)
		try {
			const { basePriceMinor, ...required } = mapping
			const response = await previewCatalogImport(
				context.session!.accessToken,
				{
					workspaceId: context.workspace.workspaceId,
					...file,
					sheet: sheet.name,
					mapping: {
						...required,
						...(basePriceMinor ? { basePriceMinor } : {})
					}
				}
			)
			if (current() && version === sequence.current) setPreview(response)
		} catch (cause) {
			if (current() && version === sequence.current)
				setError(commerceFormError(cause))
		} finally {
			if (current() && version === sequence.current) setBusy(false)
		}
	}
	const downloadTemplate = () => {
		const csv =
			'\uFEFF"Код / артикул";"Тип";"Название";"Единица";"Базовая цена, ₽"\r\n"T-001";"Товар";"Образец товара";"шт.";"1500,00"\r\n"U-001";"Услуга";"Образец услуги";"час";"2500,00"\r\n'
		try {
			downloadCommerceBlob(
				new Blob([csv], { type: 'text/csv;charset=utf-8' }),
				'aerocrm-catalog-template.csv'
			)
		} catch {
			toast.error('Не удалось скачать шаблон.')
		}
	}
	if (!context.canRead)
		return (
			<Drawer
				isOpen
				title="Импорт каталога"
				onClose={() => {
					if (!busy && command.canClose()) onClose()
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
			size="lg"
			title="Импорт каталога"
			description="Excel XLSX или CSV · до 1 МБ и 500 строк за один импорт."
			onClose={() => {
				if (!busy && command.canClose()) onClose()
			}}
		>
			<div className={styles.stack}>
				<CommerceCommandState
					command={command}
					onReview={async () => {
						const authority = await context.permissions.refetch()
						if (authority.isError) throw new Error()
						setPreview(null)
						setError(
							'Создайте новый предпросмотр, чтобы проверить актуальные данные каталога.'
						)
					}}
				/>
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				{result ? (
					<section
						className={styles.section}
						aria-label="Результат импорта"
					>
						<h3>Импорт завершён</h3>
						<p>
							Создано: {result.created}. Обновлено: {result.updated}. Без
							изменений: {result.unchanged}.
						</p>
						<p className={styles.muted}>
							Существующие сделки и КП сохранили свои цены. Позиции,
							которых нет в файле, остались в каталоге.
						</p>
						<Button onClick={onClose}>Закрыть</Button>
					</section>
				) : (
					<>
						<section className={styles.section}>
							<h3>1. Выберите файл</h3>
							<Button variant="secondary" onClick={downloadTemplate}>
								Скачать шаблон CSV
							</Button>
							<label className={styles.stack}>
								<span>Файл каталога</span>
								<input
									className={styles.file}
									type="file"
									accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
									disabled={locked}
									onChange={event => void chooseFile(event)}
								/>
							</label>
							<p className={styles.muted}>
								Код обязателен и сопоставляется точно внутри рабочего
								пространства. В Excel задайте столбцу кодов формат
								«Текстовый», чтобы сохранить ведущие нули. Формулы, макросы
								и внешние ссылки не допускаются.
							</p>
						</section>
						{busy && (
							<ScreenState
								variant="loading"
								compact
								title="Проверяем файл"
							/>
						)}
						{file && sheet && (
							<section className={styles.section}>
								<h3>2. Сопоставьте столбцы</h3>
								<p className={styles.muted}>
									{file.filename} · строк: {sheet.rowCount}
								</p>
								{sheets.length > 1 && (
									<SelectField
										label="Лист Excel"
										value={sheetName}
										disabled={locked}
										onChange={event => {
											const selected = sheets.find(
												item => item.name === event.target.value
											)!
											setSheetName(selected.name)
											setMapping(mapHeaders(selected.headers))
											setPreview(null)
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
									{mappingFields.map(field => (
										<SelectField
											key={field.key}
											label={field.label}
											required={field.key !== 'basePriceMinor'}
											value={mapping[field.key]}
											disabled={locked}
											onChange={event => {
												setMapping(value => ({
													...value,
													[field.key]: event.target.value
												}))
												setPreview(null)
											}}
										>
											<option value="">
												{field.key === 'basePriceMinor'
													? 'Не загружать цену'
													: 'Выберите столбец'}
											</option>
											{sheet.headers.map(header => (
												<option key={header} value={header}>
													{header}
												</option>
											))}
										</SelectField>
									))}
								</div>
								<p className={styles.muted}>
									Цена указывается в рублях. Пустая цена при обновлении
									сохраняет действующую. Новая позиция с пустой ценой
									потребует указать её в сделке.
								</p>
								{sheet.sample.length > 0 && (
									<div
										className={styles.tableWrap}
										tabIndex={0}
										aria-label="Пример исходных строк"
									>
										<table>
											<caption className={styles.muted}>
												Первые строки выбранного листа
											</caption>
											<thead>
												<tr>
													{sheet.headers.map(header => (
														<th key={header} scope="col">
															{header}
														</th>
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
								)}
								<Button
									disabled={
										locked ||
										!mapping.code ||
										!mapping.kind ||
										!mapping.name ||
										!mapping.unit
									}
									onClick={() => void prepare()}
								>
									Проверить предпросмотр
								</Button>
							</section>
						)}
						{preview && (
							<section className={styles.section}>
								<h3>3. Проверьте изменения</h3>
								<p>
									Будет создано: {preview.summary.created}. Обновлено:{' '}
									{preview.summary.updated}. Без изменений:{' '}
									{preview.summary.unchanged}. Ошибок:{' '}
									{preview.summary.errors}.
								</p>
								<p className={styles.muted}>
									Предпросмотр действует до{' '}
									{new Date(preview.expiresAt).toLocaleTimeString(
										'ru-RU',
										{ hour: '2-digit', minute: '2-digit' }
									)}
									. Если каталог изменится, понадобится новый предпросмотр.
								</p>
								{preview.summary.errors > 0 && (
									<p className={styles.error}>
										Исправьте указанные ошибки в исходном файле и загрузите
										его повторно. Можно также исправить сопоставление
										столбцов. Пока есть ошибки, импорт не применяется.
									</p>
								)}
								<div
									className={styles.tableWrap}
									tabIndex={0}
									aria-label="Предпросмотр изменений каталога"
								>
									<table>
										<thead>
											<tr>
												<th scope="col">Строка</th>
												<th scope="col">Код / позиция</th>
												<th scope="col">Тип / единица</th>
												<th scope="col">Цена</th>
												<th scope="col">Действие / ошибки</th>
											</tr>
										</thead>
										<tbody>
											{preview.rows.map(row => (
												<tr key={row.row}>
													<td>{row.row}</td>
													<td>
														<strong>{row.code || '—'}</strong>
														<br />
														{row.name}
													</td>
													<td>
														{row.kind === 'PRODUCT'
															? 'Товар'
															: row.kind === 'SERVICE'
																? 'Услуга'
																: row.kind}
														<br />
														{row.unit}
													</td>
													<td>
														{row.basePriceMinor === null
															? row.action === 'UPDATE'
																? 'Сохранить текущую'
																: 'Не указана'
															: salesMoney(row.basePriceMinor)}
													</td>
													<td>
														{actionLabels[row.action]}
														{row.errors.map((message, index) => (
															<p key={index} className={styles.error}>
																{message}
															</p>
														))}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
								<p className={styles.muted}>
									Повторный импорт обновляет позиции только по коду.
									Пропущенные позиции не удаляются, архивные не
									восстанавливаются, цены в старых сделках не меняются.
								</p>
								<Button
									disabled={
										locked ||
										preview.summary.errors > 0 ||
										preview.rows.length === 0
									}
									isLoading={command.running}
									onClick={() => {
										if (Date.parse(preview.expiresAt) <= Date.now()) {
											setError(
												'Срок предпросмотра истёк. Проверьте данные снова.'
											)
											return
										}
										void command.execute({ previewId: preview.previewId })
									}}
								>
									Применить импорт
								</Button>
							</section>
						)}
					</>
				)}
			</div>
		</Drawer>
	)
}
