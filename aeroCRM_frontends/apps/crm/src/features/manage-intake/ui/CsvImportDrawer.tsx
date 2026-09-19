'use client'

import { TeamSelect, useTeamOptions } from '@/entities/crm-team'
import {
	csvImportCommandError,
	type CsvImportSummary
} from '@/entities/intake'
import { useSessionStore } from '@/entities/session'
import {
	Button,
	DataTable,
	Drawer,
	ScreenState,
	TextField,
	type DataTableColumn
} from '@/shared/ui'
import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import toast from 'react-hot-toast'
import {
	inboxCsvTemplate,
	InboxCsvError,
	readInboxCsvFile,
	type InboxCsvRow
} from '../model/inbox-csv'
import type { IntakeAccess } from '../model/use-intake-access'
import { useCsvImportCommand } from '../model/use-csv-import-command'
import styles from './CsvImportDrawer.module.scss'

interface Props {
	access: IntakeAccess
	onClose: () => void
	onSaved: () => void
}
export const CsvImportDrawer = (props: Props) => (
	<CsvImportPanel
		key={JSON.stringify([
			props.access.workspaceId,
			props.access.session?.userId,
			props.access.revision,
			props.access.scopeKey
		])}
		{...props}
	/>
)

const previewColumns: DataTableColumn<InboxCsvRow>[] = [
	{ id: 'title', header: 'Тема', render: row => row.title },
	{ id: 'name', header: 'Имя', render: row => row.name },
	{ id: 'phone', header: 'Телефон', render: row => row.phone ?? '—' },
	{ id: 'email', header: 'Email', render: row => row.email ?? '—' }
]
const CsvImportPanel = ({ access, onClose, onSaved }: Props) => {
	const [rows, setRows] = useState<InboxCsvRow[]>([])
	const [label, setLabel] = useState('Импорт CSV')
	const [teamId, setTeamId] = useState('')
	const teams = useTeamOptions(
		{
			workspaceId: access.workspaceId,
			subject: access.session?.userId,
			accessToken: access.session?.accessToken,
			sessionRevision: access.revision,
			permissionScope: access.scopeKey,
			teamIds: access.permissions.data?.teamIds ?? [],
			enabled: access.canRead
		},
		teamId
	)
	const [reading, setReading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [summary, setSummary] = useState<CsvImportSummary | null>(null)
	const live = useRef({ mounted: false, canWrite: access.canWrite })
	const fileRevision = useRef(0)
	useLayoutEffect(() => {
		live.current = { mounted: true, canWrite: access.canWrite }
		return () => {
			live.current.mounted = false
		}
	}, [access.canWrite])
	const current = () => {
		const session = useSessionStore.getState()
		return (
			live.current.mounted &&
			session.status === 'authenticated' &&
			session.session?.userId === access.session?.userId &&
			session.session?.accessToken === access.session?.accessToken &&
			session.sessionRevision === access.revision
		)
	}
	const command = useCsvImportCommand(access, result => {
		setRows([])
		setSummary(result)
		setError(null)
		toast.success(
			`Импорт подтверждён: ${result.rowCount} обращений добавлено во входящие`
		)
		onSaved()
	})
	const denied =
		!command.uncertain &&
		!!command.error &&
		['unauthorized', 'forbidden', 'conflict', 'notFound'].includes(
			command.error.kind
		)
	const writable =
		access.canWrite && access.permissions.data?.role !== 'ANALYST'
	const editable =
		writable && !reading && !command.locked && !denied && !summary
	const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0]
		event.currentTarget.value = ''
		if (!file || !editable || !current()) return
		const revision = ++fileRevision.current
		setReading(true)
		setRows([])
		setError(null)
		try {
			const parsed = await readInboxCsvFile(file)
			if (
				!current() ||
				!live.current.canWrite ||
				revision !== fileRevision.current
			)
				return
			setRows(parsed)
			toast.success(`CSV проверен: ${parsed.length} обращений`)
		} catch (cause) {
			if (
				!current() ||
				!live.current.canWrite ||
				revision !== fileRevision.current
			)
				return
			const message =
				cause instanceof InboxCsvError
					? cause.message
					: 'Не удалось проверить CSV.'
			setError(message)
			toast.error(message)
		} finally {
			if (current() && revision === fileRevision.current) setReading(false)
		}
	}
	const close = () => {
		if (reading || command.locked) {
			toast(
				'Дождитесь проверки файла или подтвердите результат той же команды. Данные импорта не изменены.'
			)
			return
		}
		toast(summary ? 'Импорт завершён' : 'Панель импорта закрыта')
		onClose()
	}
	const downloadTemplate = () => {
		let url: string | undefined
		const link = document.createElement('a')
		try {
			url = URL.createObjectURL(
				new Blob([inboxCsvTemplate], { type: 'text/csv;charset=utf-8' })
			)
			link.href = url
			link.download = 'wincrm-inbox-template.csv'
			document.body.appendChild(link)
			link.click()
			toast('Шаблон CSV подготовлен')
		} catch {
			toast.error('Не удалось подготовить шаблон CSV.')
		} finally {
			link.remove()
			if (url) {
				const created = url
				window.setTimeout(() => URL.revokeObjectURL(created), 0)
			}
		}
	}
	const submit = () => {
		if (!editable || !current() || !navigator.onLine) return
		if (!teams.validSelection) {
			setError('Выберите доступный отдел или «Без отдела».')
			toast.error('Выберите доступный отдел')
			return
		}
		const input = {
			workspaceId: access.workspaceId,
			commandId: crypto.randomUUID(),
			label: label.trim(),
			teamId: teamId || null,
			rows
		}
		const message = csvImportCommandError(input)
		if (message) {
			setError(message)
			toast.error(message)
			return
		}
		setError(null)
		toast('Отправляем проверенные обращения во входящие')
		void command.execute(() => input)
	}
	return (
		<Drawer
			isOpen
			onClose={close}
			title="Импорт CSV"
			size="lg"
			description="До 250 обращений, CSV в UTF-8 размером до 1 МБ. Весь файл проверяется до отправки."
		>
			<div className={styles.content}>
				<p className={styles.notice}>
					Импорт создаёт только новые входящие обращения. Контакты, сделки
					и задачи автоматически не создаются. Повторяющиеся строки файла
					не объединяются.
				</p>
				{!writable ? (
					<ScreenState
						variant="permission"
						title="Импорт недоступен"
						description="Нужны подтверждённые права на создание обращений, доступ на редактирование и подключение к сети."
					/>
				) : summary ? (
					<section
						className={styles.receipt}
						aria-label="Результат импорта"
					>
						<h3>Импорт подтверждён сервером</h3>
						<p>
							Добавлено обращений: {summary.rowCount}. Они доступны во
							«Входящих» со статусом «Новое».
						</p>
						<p>
							Идентификатор: <span>{summary.id}</span>
						</p>
						<p>
							Создан: {new Date(summary.createdAt).toLocaleString('ru-RU')}
						</p>
						<Button onClick={close}>Готово</Button>
					</section>
				) : (
					<>
						<div className={styles.actions}>
							<Button variant="secondary" onClick={downloadTemplate}>
								Скачать шаблон CSV
							</Button>
						</div>
						<p className={styles.note}>
							Разделитель — запятая или точка с запятой. Заголовки: title,
							name, phone, email, message; обязательны title и name.
							Телефоны — в международном формате +79001234567. Имя файла не
							сохраняется автоматически.
						</p>
						<TextField
							label="Название импорта"
							maxLength={200}
							value={label}
							readOnly={!editable}
							onChange={event => setLabel(event.target.value)}
						/>
						{access.permissions.data?.teamIds.length || teamId ? (
							<TeamSelect
								label="Отдел импорта"
								options={teams}
								value={teamId}
								disabled={!editable}
								onChange={setTeamId}
							/>
						) : null}
						<TextField
							label="Файл CSV"
							type="file"
							accept=".csv,text/csv"
							disabled={!editable}
							onChange={event => void readFile(event)}
						/>
						{reading ? <p role="status">Проверяем файл…</p> : null}
						{!command.locked && rows.length ? (
							<section
								className={styles.preview}
								aria-label="Предварительный просмотр CSV"
							>
								<h3>Проверено обращений: {rows.length}</h3>
								<p>
									Показаны первые {Math.min(rows.length, 10)} строк.
									Импортированы будут все {rows.length}.
								</p>
								<DataTable
									columns={previewColumns}
									rows={rows.slice(0, 10)}
									getRowKey={row => String(rows.indexOf(row))}
									caption="Локальный предварительный просмотр CSV"
									embedded
								/>
							</section>
						) : null}
						{command.uncertain ? (
							<p className={styles.notice} role="status">
								Результат предыдущего импорта неизвестен. Сохранены
								исходные строки и UUID только в памяти этой вкладки. Повтор
								отправит точно ту же команду; новый импорт недоступен до
								подтверждения результата.
							</p>
						) : null}
						{error || command.error ? (
							<p className={styles.error} role="alert">
								{error ?? command.error?.message}
							</p>
						) : null}
						{denied ? (
							<p className={styles.notice}>
								Доступ или параметры команды требуют повторной проверки.
								Закройте панель и проверьте данные перед новым импортом.
							</p>
						) : null}
						<div className={styles.actions}>
							<Button variant="secondary" onClick={close}>
								Отмена
							</Button>
							{command.locked ? (
								<Button
									disabled={!writable || command.running}
									isLoading={command.running}
									onClick={() => void command.execute()}
								>
									Повторить тот же импорт
								</Button>
							) : (
								<Button
									disabled={
										!editable || !rows.length || !teams.validSelection
									}
									onClick={submit}
								>
									Импортировать обращения
								</Button>
							)}
						</div>
					</>
				)}
			</div>
		</Drawer>
	)
}
