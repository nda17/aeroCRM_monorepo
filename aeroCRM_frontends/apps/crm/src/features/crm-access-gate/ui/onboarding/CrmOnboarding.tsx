'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useEffect, useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import type { CrmResolvedAccessResponse } from '@/entities/crm-access'
import type { PipelineTemplate } from '@/entities/pipeline-template'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { Button, ScreenState } from '@/shared/ui'

import {
	getPipelineTemplates,
	installCrmTemplate
} from '../../api/crm-access.api'
import { pipelineTemplatesQueryKey } from '../../model/crm-access.queries'
import {
	sessionOwnedRequest,
	type SessionOwnedRequest
} from '../../model/session-owned-request'
import type {
	CrmTemplateInstallationResponse,
	InstallCrmTemplateCommand
} from '../../model/crm-template-installation.types'
import gateStyles from '../AccessGate.module.scss'
import styles from './CrmOnboarding.module.scss'

interface CrmOnboardingProps {
	access: CrmResolvedAccessResponse
	accessRevalidating: boolean
	accessValidationFailed: boolean
	onInstalled: (result: CrmTemplateInstallationResponse) => void
	onRevalidateAccess: () => void
}

const templateRevisionId = (template: PipelineTemplate) =>
	`${template.key}@${template.version}`

// Display labels only: catalog keys, versions and installation commands stay intact.
const industryLabels: Readonly<Record<string, string>> = {
	sales: 'Продажи',
	services: 'Услуги',
	b2b: 'Для бизнеса',
	b2c: 'Для частных клиентов',
	appointments: 'Запись клиентов',
	beauty: 'Красота',
	healthcare: 'Медицина',
	retail: 'Розничная торговля',
	ecommerce: 'Интернет-торговля',
	orders: 'Заказы',
	wholesale: 'Оптовая торговля',
	manufacturing: 'Производство',
	agency: 'Агентства',
	consulting: 'Консалтинг',
	it: 'ИТ-услуги',
	projects: 'Проекты',
	education: 'Образование',
	courses: 'Курсы',
	schools: 'Школы',
	fitness: 'Фитнес',
	memberships: 'Абонементы',
	wellness: 'Оздоровление',
	construction: 'Строительство',
	repair: 'Ремонт',
	'home-services': 'Услуги для дома',
	logistics: 'Логистика',
	delivery: 'Доставка',
	transportation: 'Перевозки'
}

const industryLabel = (tag: string) =>
	Object.hasOwn(industryLabels, tag) ? industryLabels[tag] : 'Другая сфера'

export const CrmOnboarding = ({
	access,
	accessRevalidating,
	accessValidationFailed,
	onInstalled,
	onRevalidateAccess
}: CrmOnboardingProps) => {
	const session = useSessionStore(state => state.session)
	const sessionRevision = useSessionStore(state => state.sessionRevision)
	const setAnonymous = useSessionStore(state => state.setAnonymous)
	const fieldsetId = useId()
	const errorRef = useRef<HTMLDivElement>(null)
	const commandRef = useRef<InstallCrmTemplateCommand | undefined>(
		undefined
	)
	const submittedTemplateRef = useRef<PipelineTemplate | undefined>(
		undefined
	)
	const toastIdRef = useRef<string | undefined>(undefined)
	const requestPendingRef = useRef(false)
	const [selectedRevision, setSelectedRevision] = useState('')
	const [submittedTemplate, setSubmittedTemplate] =
		useState<PipelineTemplate>()
	const [inlineError, setInlineError] = useState<string>()
	const isOwner = access.membership.role === 'OWNER'
	const templates = useQuery({
		queryKey: [
			...pipelineTemplatesQueryKey(
				session?.userId ?? '',
				access.selectedWorkspaceId
			),
			sessionRevision
		],
		queryFn: async () => {
			const request = sessionOwnedRequest(
				session,
				sessionRevision,
				undefined,
				token => getPipelineTemplates(token)
			)
			try {
				return await request.execute()
			} catch (error) {
				if (
					request.isCurrent() &&
					error instanceof AuthenticatedApiError &&
					error.kind === 'unauthorized'
				) {
					toast.error('Сессия завершена. Переходим к авторизации.')
					setAnonymous()
				}
				throw error
			}
		},
		enabled: Boolean(session),
		retry: false
	})

	useEffect(() => {
		if (inlineError) errorRef.current?.focus()
	}, [inlineError])

	const selectedTemplate = templates.data?.templates.find(
		template => templateRevisionId(template) === selectedRevision
	)

	const installation = useMutation({
		mutationFn: (
			request: SessionOwnedRequest<
				InstallCrmTemplateCommand,
				CrmTemplateInstallationResponse
			>
		) => request.execute(),
		onSuccess: (result, request) => {
			if (!request.isCurrent()) return
			const toastOptions = toastIdRef.current
				? { id: toastIdRef.current }
				: undefined
			const installedTemplateName =
				submittedTemplateRef.current?.name ?? selectedTemplate?.name
			commandRef.current = undefined
			submittedTemplateRef.current = undefined
			setSubmittedTemplate(undefined)
			toastIdRef.current = undefined
			setInlineError(undefined)
			toast.success(
				`Воронка «${installedTemplateName ?? 'aeroCRM'}» создана`,
				toastOptions
			)
			onInstalled(result)
		},
		onError: (error, request) => {
			if (!request.isCurrent()) return
			const toastOptions = toastIdRef.current
				? { id: toastIdRef.current }
				: undefined
			toastIdRef.current = undefined

			if (
				error instanceof AuthenticatedApiError &&
				error.kind === 'unauthorized'
			) {
				toast.error(
					'Сессия завершена. Переходим к авторизации.',
					toastOptions
				)
				setAnonymous()
				return
			}

			if (
				error instanceof AuthenticatedApiError &&
				error.kind === 'conflict'
			) {
				commandRef.current = undefined
				submittedTemplateRef.current = undefined
				setSubmittedTemplate(undefined)
				setInlineError(
					'Настройка рабочего пространства уже изменилась. Обновляем состояние доступа.'
				)
				toast.error('Настройка aeroCRM уже изменилась', toastOptions)
				onRevalidateAccess()
				return
			}

			if (
				error instanceof AuthenticatedApiError &&
				error.kind === 'notFound'
			) {
				commandRef.current = undefined
				submittedTemplateRef.current = undefined
				setSubmittedTemplate(undefined)
				setSelectedRevision('')
				setInlineError(
					'Эта версия шаблона больше недоступна. Каталог обновляется — выберите шаблон повторно.'
				)
				toast.error('Версия шаблона не найдена', toastOptions)
				void templates.refetch()
				return
			}

			if (
				error instanceof AuthenticatedApiError &&
				error.kind === 'forbidden'
			) {
				commandRef.current = undefined
				submittedTemplateRef.current = undefined
				setSubmittedTemplate(undefined)
				setInlineError(
					'Права или состояние подписки изменились. Обновляем доступ к рабочему пространству.'
				)
				toast.error(
					'Недостаточно прав для установки шаблона',
					toastOptions
				)
				onRevalidateAccess()
				return
			}

			setInlineError(
				'Не удалось подтвердить результат установки. Безопасно повторите запрос: будет использован тот же идентификатор команды.'
			)
			toast.error('Не удалось подтвердить установку шаблона', toastOptions)
		},
		onSettled: (_result, _error, request) => {
			if (!request.isCurrent()) return
			requestPendingRef.current = false
		}
	})

	const hasUnknownResult =
		installation.isError &&
		(!(installation.error instanceof AuthenticatedApiError) ||
			installation.error.kind === 'temporary')
	const installationTemplate = hasUnknownResult
		? submittedTemplate
		: selectedTemplate
	const selectionDisabled =
		!isOwner ||
		installation.isPending ||
		hasUnknownResult ||
		accessRevalidating ||
		templates.isFetching
	const descriptionId = `${fieldsetId}-copy`
	const ownerNoteId = `${fieldsetId}-owner-note`
	const errorId = `${fieldsetId}-error`
	const buttonDescription = [
		descriptionId,
		!isOwner ? ownerNoteId : undefined,
		inlineError ? errorId : undefined
	]
		.filter(Boolean)
		.join(' ')

	if (accessValidationFailed) {
		return (
			<ScreenState
				variant="error"
				title="Не удалось подтвердить доступ"
				description="Настройка aeroCRM заблокирована до успешной повторной проверки. Выбранный шаблон и безопасный идентификатор повтора сохранены."
				action={
					<Button
						isLoading={accessRevalidating}
						onClick={() => {
							onRevalidateAccess()
						}}
					>
						Повторить проверку
					</Button>
				}
			/>
		)
	}

	if (templates.isPending) {
		return <ScreenState variant="loading" title="Загружаем шаблоны CRM" />
	}

	if (templates.isError && !templates.data) {
		return (
			<ScreenState
				variant="error"
				title="CRM временно недоступна"
				description="Не удалось загрузить каталог шаблонов. Рабочая область останется закрыта."
				action={
					<Button
						onClick={() => {
							void templates.refetch()
						}}
					>
						Повторить
					</Button>
				}
			/>
		)
	}

	const buttonLabel = !isOwner
		? 'Требуются права владельца'
		: installation.isPending
			? 'Создаём воронку…'
			: hasUnknownResult
				? 'Безопасно повторить установку'
				: installationTemplate
					? `Создать воронку «${installationTemplate.name}»`
					: 'Выберите шаблон'

	return (
		<div className={gateStyles.panel}>
			<h1>Настройка aeroCRM</h1>
			<p className={styles.intro}>
				Выберите процесс, с которого начнёт работу ваша команда.
			</p>
			<form
				className={styles.form}
				onSubmit={event => {
					event.preventDefault()
					const templateToInstall = hasUnknownResult
						? submittedTemplateRef.current
						: selectedTemplate
					if (
						!isOwner ||
						!session ||
						!templateToInstall ||
						accessRevalidating ||
						requestPendingRef.current
					)
						return

					requestPendingRef.current = true
					submittedTemplateRef.current ??= templateToInstall
					setSubmittedTemplate(current => current ?? templateToInstall)
					commandRef.current ??= {
						commandId: crypto.randomUUID(),
						workspaceId: access.selectedWorkspaceId,
						templateKey: templateToInstall.key,
						templateVersion: templateToInstall.version
					}
					setInlineError(undefined)
					toastIdRef.current = toast.loading('Пожалуйста, подождите')
					installation.mutate(
						sessionOwnedRequest(
							session,
							sessionRevision,
							commandRef.current,
							installCrmTemplate
						)
					)
				}}
			>
				<fieldset
					className={styles.fieldset}
					disabled={selectionDisabled}
					aria-describedby={descriptionId}
				>
					<legend className={styles.legend}>
						Выберите бизнес-процесс
					</legend>
					<div className={styles.catalog}>
						{templates.data.templates.map(template => {
							const revision = templateRevisionId(template)
							const inputId = `${fieldsetId}-${template.key}-${template.version}`
							const isSelected = selectedRevision === revision

							return (
								<article
									className={clsx(
										styles.card,
										isSelected && styles.cardSelected,
										selectionDisabled && styles.cardDisabled
									)}
									key={revision}
								>
									<input
										className={styles.radio}
										id={inputId}
										type="radio"
										name="pipeline-template"
										value={revision}
										checked={isSelected}
										disabled={selectionDisabled}
										aria-labelledby={`${inputId}-name ${inputId}-version`}
										aria-describedby={`${inputId}-description ${inputId}-stages`}
										onChange={() => {
											commandRef.current = undefined
											submittedTemplateRef.current = undefined
											setSubmittedTemplate(undefined)
											setSelectedRevision(revision)
											setInlineError(undefined)
											installation.reset()
										}}
									/>
									<label
										className={clsx(
											styles.cardClickTarget,
											selectionDisabled && styles.cardClickTargetDisabled
										)}
										htmlFor={inputId}
									>
										<span className={styles.srOnly}>
											Выбрать шаблон {template.name}, версия{' '}
											{template.version}
										</span>
									</label>
									<div className={styles.cardBody}>
										<div className={styles.cardHeader}>
											<h2
												className={styles.cardTitle}
												id={`${inputId}-name`}
											>
												{template.name}
											</h2>
											<span
												className={styles.version}
												id={`${inputId}-version`}
											>
												Версия {template.version}
											</span>
										</div>
										<p
											className={styles.description}
											id={`${inputId}-description`}
										>
											{template.description}
										</p>
										<ul
											className={styles.tags}
											aria-label="Сферы применения"
										>
											{template.industryTags.map(tag => (
												<li className={styles.tag} key={tag}>
													{industryLabel(tag)}
												</li>
											))}
										</ul>
										<div id={`${inputId}-stages`}>
											<p className={styles.stagesLabel}>Этапы процесса:</p>
											<ol className={styles.stages}>
												{template.stages.map((stage, index) => (
													<li className={styles.stage} key={stage.key}>
														{stage.name}
														{index < template.stages.length - 1 ? (
															<span
																className={styles.arrow}
																aria-hidden="true"
															>
																→
															</span>
														) : null}
													</li>
												))}
											</ol>
										</div>
									</div>
								</article>
							)
						})}
					</div>
				</fieldset>

				<p className={styles.copy} id={descriptionId}>
					aeroCRM создаст независимую копию процесса. Будущие обновления
					шаблона не изменят вашу воронку.
				</p>
				{!isOwner ? (
					<p className={styles.ownerNote} id={ownerNoteId}>
						Завершить настройку может только владелец рабочего
						пространства.
					</p>
				) : null}
				{inlineError ? (
					<div
						ref={errorRef}
						className={styles.error}
						id={errorId}
						role="alert"
						tabIndex={-1}
					>
						{inlineError}
					</div>
				) : null}
				<div className={styles.actions}>
					<Button
						type="submit"
						fullWidth
						disabled={
							!isOwner ||
							!installationTemplate ||
							accessRevalidating ||
							templates.isFetching
						}
						isLoading={installation.isPending}
						aria-describedby={buttonDescription}
					>
						{buttonLabel}
					</Button>
				</div>
				{installation.isPending ? (
					<p className={styles.status} role="status" aria-live="polite">
						Создаём воронку и подтверждаем доступ к рабочему пространству.
					</p>
				) : accessRevalidating ? (
					<p className={styles.status} role="status" aria-live="polite">
						Проверяем актуальное состояние доступа.
					</p>
				) : null}
			</form>
		</div>
	)
}
