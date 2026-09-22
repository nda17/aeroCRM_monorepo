'use client'

import { downloadCommerceExport } from '@/entities/sales/api/commerce.api'
import { getCrmPermissions } from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import { Button, Drawer, SelectField } from '@/shared/ui'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { commerceFormError } from '../model/commerce-form'
import { useSalesSession } from '../model/use-sales-session'
import styles from './Commerce.module.scss'

export const CommerceExportControl = () => {
	const context = useSalesSession()
	const [open, setOpen] = useState(false)
	const [format, setFormat] = useState<'json' | 'csv'>('csv')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [done, setDone] = useState(false)
	const available =
		context.canRead &&
		context.permissions.data?.role === 'OWNER' &&
		context.permissions.data.permissions.includes('sales:export')
	const start = async () => {
		if (!available || !context.session || loading) return
		setLoading(true)
		setError(null)
		setDone(false)
		try {
			const authority = await getCrmPermissions(
				context.session.accessToken,
				context.workspace.workspaceId
			)
			const current = useSessionStore.getState()
			if (
				current.session?.accessToken !== context.session.accessToken ||
				current.sessionRevision !== context.sessionRevision ||
				authority.subject !== current.session?.userId ||
				authority.role !== 'OWNER' ||
				!authority.permissions.includes('sales:read') ||
				!authority.permissions.includes('sales:export')
			)
				throw new Error(
					'Права изменились. Обновите страницу перед экспортом.'
				)
			await downloadCommerceExport(
				context.session.accessToken,
				context.workspace.workspaceId,
				format
			)
			setDone(true)
			toast.success('Экспорт подготовлен для скачивания')
		} catch (cause) {
			setError(commerceFormError(cause))
		} finally {
			setLoading(false)
		}
	}
	if (!available) return null
	return (
		<>
			<Button
				variant="secondary"
				onClick={() => {
					setOpen(true)
					setError(null)
					setDone(false)
				}}
			>
				Экспорт каталога, позиций и оплат
			</Button>
			{open && (
				<Drawer
					isOpen
					title="Экспорт каталога, позиций и оплат"
					onClose={() => {
						if (!loading) setOpen(false)
					}}
				>
					<div className={styles.stack}>
						<p className={styles.muted}>
							Выгрузка всех доступных данных пространства, включая архивные
							позиции каталога, состав сделок и журнал оплат с
							исправлениями. Фильтры текущего экрана не ограничивают файл.
							Обычный экспорт сделок остаётся отдельным действием.
						</p>
						<SelectField
							label="Формат файла"
							value={format}
							disabled={loading}
							onChange={event =>
								setFormat(event.target.value as 'json' | 'csv')
							}
						>
							<option value="csv">CSV — таблица</option>
							<option value="json">JSON — структурированные данные</option>
						</SelectField>
						<p className={styles.muted}>
							В файле суммы хранятся в копейках. Виды строк CSV отделяют
							каталог, позиции и денежные операции. Это выгрузка данных, а
							не шаблон для импорта каталога.
						</p>
						{error && (
							<p className={styles.error} role="alert">
								{error}
							</p>
						)}
						{done && (
							<p className={styles.notice} role="status">
								Файл подготовлен для скачивания.
							</p>
						)}
						<Button
							disabled={loading}
							isLoading={loading}
							onClick={() => void start()}
						>
							Скачать экспорт
						</Button>
					</div>
				</Drawer>
			)}
		</>
	)
}
