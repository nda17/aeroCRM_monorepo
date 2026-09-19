'use client'

import { UserRole, useAuthStore, useUser } from '@/entities/user'
import {
	crmProviderOperationsService,
	type CrmProviderOperationStatus
} from '@/features/admin-crm'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AdminCrm.module.scss'

const statuses: { value: '' | CrmProviderOperationStatus; label: string }[] = [
	{ value: '', label: 'Все статусы' },
	{ value: 'UNKNOWN', label: 'Неизвестен' },
	{ value: 'FAILED', label: 'Ошибка' },
	{ value: 'PENDING', label: 'Ожидает' },
	{ value: 'PROCESSING', label: 'Обрабатывается' },
	{ value: 'DELIVERED', label: 'Доставлена' }
]

export default function CrmProviderOperations() {
	const auth = useAuthStore(state => state.auth)
	const resolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading } = useUser()
	const canView = Boolean(
		resolved && auth && !isLoading &&
		user.rights?.some(role => role === UserRole.ADMIN || role === UserRole.DEV)
	)
	const canRetry = Boolean(user.rights?.includes(UserRole.DEV))
	const [status, setStatus] = useState<'' | CrmProviderOperationStatus>('UNKNOWN')
	const [page, setPage] = useState(1)
	const client = useQueryClient()
	const key = ['crm-provider-operations', page, status]
	const operations = useQuery({
		queryKey: key,
		queryFn: () => crmProviderOperationsService.list(page, status || undefined),
		enabled: canView,
		retry: 1
	})
	const retry = useMutation({
		mutationFn: crmProviderOperationsService.retry,
		onSuccess: async () => {
			toast.success('Повторная сверка с ЮKassa поставлена в очередь')
			await client.invalidateQueries({ queryKey: ['crm-provider-operations'] })
		},
		onError: () => toast.error('Не удалось запустить повторную сверку')
	})

	return (
		<section className={styles.section} aria-labelledby="crm-provider-operations-title">
			<div className={styles.sectionHeader}>
				<div>
					<h3 id="crm-provider-operations-title" className={styles.sectionTitle}>Операции оплаты CRM</h3>
					<p className={styles.sectionHint}>Состояние операций ЮKassa. Повторная сверка доступна DEV и проверяет результат у провайдера.</p>
				</div>
				<AdminTooltip title="Сверка оплат" description="ADMIN и DEV видят операции. Только DEV может повторно проверить неопределённую или ошибочную операцию у ЮKassa. Результат оплаты вручную не назначается." risk="medium" />
			</div>
			{!resolved || isLoading ? <p role="status">Проверяем доступ...</p> : !canView ? (
				<p>Просмотр доступен ADMIN и DEV.</p>
			) : <>
				<label className={styles.sectionHint} htmlFor="crm-provider-status">Статус</label>
				<select id="crm-provider-status" className={styles.providerSelect} value={status} onChange={event => { setStatus(event.target.value as typeof status); setPage(1) }}>
					{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
				</select>
				{operations.isLoading ? <p role="status">Загружаем операции...</p> : operations.isError ? (
				<button type="button" className={styles.refreshButton} onClick={() => void operations.refetch()}>Не удалось загрузить. Повторить</button>
				) : <>
					<p className={styles.sectionHint}>Найдено: {operations.data?.total ?? 0}</p>
					{operations.data?.items.map(operation => <article className={styles.providerOperation} key={operation.id}>
						<strong>{operation.status} · {operation.kind}</strong>
						<span>Заказ {operation.orderId} · workspace {operation.workspaceId}</span>
						<span>{(Number(operation.order.amountMinor) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {operation.order.currency} · {operation.order.status}</span>
						{operation.lastErrorCode && <span>Ошибка: {operation.lastErrorCode}</span>}
						<small>Обновлено: {new Date(operation.updatedAt).toLocaleString('ru-RU')}</small>
						{(operation.status === 'UNKNOWN' || operation.status === 'FAILED') && <div className={!canRetry ? styles.providerLocked : undefined}>
							<button type="button" className={styles.refreshButton} disabled={!canRetry || retry.isPending} onClick={() => retry.mutate(operation)}>Повторить сверку</button>
							{!canRetry && <small>Требуется роль DEV</small>}
						</div>}
					</article>)}
					{operations.data?.items.length === 0 && <p>Операций с таким статусом нет.</p>}
					<div className={styles.providerPager}>
						<button type="button" className={styles.refreshButton} disabled={page <= 1} onClick={() => setPage(page - 1)}>Назад</button>
						<span>Страница {page}</span>
						<button type="button" className={styles.refreshButton} disabled={page * 20 >= (operations.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Далее</button>
					</div>
				</>}
			</>}
		</section>
	)
}
