'use client'

import { useAuthStore } from '@/entities/user'
import {
	adminCrmService,
	type CrmPipelineTemplate
} from '@/features/admin-crm'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import Heading from '@/shared/ui/heading/Heading'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { CRM_RELEASE } from '@/shared/config/crm-release.config'
import { useQuery } from '@tanstack/react-query'
import { NextPage } from 'next'
import toast from 'react-hot-toast'
import styles from './AdminCrm.module.scss'

const stageStateLabel = {
	OPEN: 'Рабочий этап',
	WON: 'Успех',
	LOST: 'Отказ'
} as const

const AdminCrm: NextPage = () => {
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)
	const { data, isLoading, isError, isFetching, refetch } = useQuery({
		queryKey: ['admin-crm-template-catalog'],
		queryFn: adminCrmService.getTemplateCatalog,
		enabled: CRM_RELEASE.apiEnabled && isAuthResolved && auth,
		staleTime: 60_000,
		retry: 1
	})

	const refreshCatalog = async () => {
		if (!CRM_RELEASE.apiEnabled || !isAuthResolved || !auth || isFetching)
			return
		const toastId = toast.loading('Пожалуйста, подождите')
		const result = await refetch()

		if (result.isError) {
			toast.error('Не удалось обновить каталог aeroCRM', { id: toastId })
			return
		}

		toast.success('Каталог aeroCRM обновлён', { id: toastId })
	}

	return (
		<section className={styles.wrapper}>
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminSectionHeading
				text="aeroCRM"
				title="Каталог aeroCRM"
				description="Операторский экран продукта. Клиентские воронки, контакты и сделки здесь не хранятся и управляются только на workspace.aerocrm.space."
				risk="low"
				riskText="Здесь доступен просмотр каталога шаблонов. Подписки, платежи и тарифы находятся в разделе «Финансы»."
			/>

			{!CRM_RELEASE.apiEnabled && (
				<div className={styles.releaseNote} role="status">
					<strong>aeroCRM · {CRM_RELEASE.unavailableLabel}</strong>
					<p>Каталог шаблонов подключится после выпуска CRM-сервисов.</p>
				</div>
			)}

			<div className={styles.summaryGrid}>
				<article className={styles.summaryCard}>
					<p className={styles.eyebrow}>Продукт</p>
					<p className={styles.summaryValue}>aeroCRM</p>
					<p className={styles.summaryHint}>workspace.aerocrm.space</p>
				</article>
				<article className={styles.summaryCard}>
					<p className={styles.eyebrow}>Бесплатный период</p>
					<p className={styles.summaryValue}>10 дней</p>
					<p className={styles.summaryHint}>
						Только после явного нажатия «Попробовать бесплатно»
					</p>
				</article>
			</div>

			<div className={styles.section}>
				<div className={styles.sectionHeader}>
					<div>
						<p className={styles.sectionTitle}>Шаблоны процессов</p>
						<p className={styles.sectionHint}>
							Версионированный каталог{' '}
							<code className={styles.inlineCode}>crm-sales</code>;
							опубликованная версия не изменяется задним числом. Новые
							версии публикуются через Git/CI
						</p>
					</div>
					<button
						type="button"
						className={styles.refreshButton}
						disabled={
							!CRM_RELEASE.apiEnabled ||
							!isAuthResolved ||
							!auth ||
							isFetching
						}
						onClick={refreshCatalog}
					>
						{isFetching ? 'Обновляем...' : 'Обновить'}
					</button>
				</div>

				{!CRM_RELEASE.apiEnabled ? (
					<p className={styles.accessNote}>
						Каталог шаблонов появится после подключения CRM-сервисов. До
						выпуска запросы к нему отключены.
					</p>
				) : !isAuthResolved || !auth || isLoading ? (
					<div className={styles.templateGrid}>
						<SkeletonLoader
							count={1}
							className={styles.templateSkeleton}
						/>
						<SkeletonLoader
							count={1}
							className={styles.templateSkeleton}
						/>
						<SkeletonLoader
							count={1}
							className={styles.templateSkeleton}
						/>
					</div>
				) : !data ? (
					<div className={styles.errorState} role="alert">
						<p className={styles.errorTitle}>Каталог пока недоступен</p>
						<p className={styles.errorText}>
							Публичный маршрут ещё не подключён или{' '}
							<code className={styles.inlineCode}>crm-sales</code> временно
							не отвечает. Повторная загрузка безопасна и ничего не
							изменяет.
						</p>
					</div>
				) : (
					<>
						{isError ? (
							<div className={styles.staleState} role="status">
								Показана последняя загруженная ревизия. Фоновое обновление
								каталога не удалось.
							</div>
						) : null}
						<div className={styles.catalogMeta}>
							<span>Схема v{data.schemaVersion}</span>
							<span>Ревизия {data.catalogRevision}</span>
							<span>Шаблонов: {data.templates.length}</span>
						</div>
						<div className={styles.templateGrid}>
							{data.templates.map(template => (
								<TemplateCard
									key={`${template.key}@${template.version}`}
									template={template}
								/>
							))}
						</div>
					</>
				)}
			</div>
		</section>
	)
}

const TemplateCard = ({ template }: { template: CrmPipelineTemplate }) => (
	<article className={styles.templateCard}>
		<div className={styles.templateHeader}>
			<div>
				<p className={styles.templateName}>{template.name}</p>
				<code className={styles.templateKey}>
					{template.key}@{template.version}
				</code>
			</div>
			{template.isBlank && (
				<span className={styles.blankBadge}>Пустой</span>
			)}
		</div>
		<p className={styles.templateDescription}>{template.description}</p>
		<div className={styles.stageList}>
			{template.stages.map(stage => (
				<span
					key={stage.key}
					className={styles[`stage_${stage.state.toLowerCase()}`]}
					title={stageStateLabel[stage.state]}
				>
					{stage.order}. {stage.name}
				</span>
			))}
		</div>
	</article>
)

export default AdminCrm
