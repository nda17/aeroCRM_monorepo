'use client'

import {
	crmPermissionScope,
	getCrmPermissions
} from '@/entities/crm-access'
import {
	isLookupInn,
	lookupCompany,
	type CompanyLookupItem,
	type CompanyLookupResult
} from '@/entities/customer'
import { useSessionStore } from '@/entities/session'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { Button, StatusBadge } from '@/shared/ui'
import { useLayoutEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './CustomerEditor.module.scss'

interface Props {
	workspaceId: string
	scopeKey?: string
	inn: string
	canWrite: boolean
	hasExisting: boolean
	hasKpp: boolean
	onApply: (item: CompanyLookupItem, replace: boolean) => boolean
}
const statusLabels: Record<CompanyLookupItem['status'], string> = {
	ACTIVE: 'Действует',
	LIQUIDATING: 'В процессе ликвидации',
	LIQUIDATED: 'Ликвидирована',
	BANKRUPT: 'Банкротство',
	REORGANIZING: 'Реорганизация',
	UNKNOWN: 'Статус не подтверждён'
}

export const CompanyLookup = (props: Props) => {
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const frame = [
		props.workspaceId,
		props.scopeKey,
		props.inn,
		props.canWrite,
		session?.accessToken,
		session?.userId,
		revision
	]
	const [binding, setBinding] = useState({ frame, generation: 0 })
	// A new authority/input frame discards the whole transient result before paint.
	// Only an opaque generation is a React key; no token or INN enters the DOM.
	if (frame.some((value, index) => value !== binding.frame[index]))
		setBinding({ frame, generation: binding.generation + 1 })
	return <CompanyLookupForm key={binding.generation} {...props} />
}

const CompanyLookupForm = ({
	workspaceId,
	scopeKey,
	inn,
	canWrite,
	hasExisting,
	hasKpp,
	onApply
}: Props) => {
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const [result, setResult] = useState<CompanyLookupResult | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [denied, setDenied] = useState(false)
	const [replace, setReplace] = useState(false)
	const active = useRef(false)
	const generation = useRef(0)
	const mounted = useRef(true)
	const latest = useRef({
		workspaceId,
		scopeKey,
		inn,
		canWrite,
		onApply,
		hasKpp
	})
	useLayoutEffect(() => {
		latest.current = {
			workspaceId,
			scopeKey,
			inn,
			canWrite,
			onApply,
			hasKpp
		}
	})
	useLayoutEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			generation.current += 1
		}
	}, [])
	const capture = () => ({
		workspaceId,
		scopeKey,
		inn,
		revision,
		token: session?.accessToken,
		subject: session?.userId,
		generation: generation.current
	})
	type Frame = ReturnType<typeof capture>
	const current = (frame: Frame) => {
		const store = useSessionStore.getState(),
			view = latest.current
		return (
			mounted.current &&
			view.canWrite &&
			generation.current === frame.generation &&
			view.workspaceId === frame.workspaceId &&
			view.scopeKey === frame.scopeKey &&
			view.inn === frame.inn &&
			!!frame.token &&
			store.session?.accessToken === frame.token &&
			store.session?.userId === frame.subject &&
			store.sessionRevision === frame.revision
		)
	}
	const authorize = async (frame: Frame) => {
		if (!current(frame)) return false
		const permissions = await getCrmPermissions(
			frame.token!,
			frame.workspaceId
		)
		if (!current(frame)) return false
		if (
			permissions.subject !== frame.subject ||
			permissions.workspaceId !== frame.workspaceId ||
			permissions.state === 'READ_ONLY' ||
			!permissions.permissions.includes('customers:write') ||
			(frame.scopeKey !== undefined &&
				crmPermissionScope(permissions) !== frame.scopeKey)
		) {
			throw new AuthenticatedApiError(
				'forbidden',
				'Доступ изменился. Обновите карточку перед поиском реквизитов.'
			)
		}
		return true
	}
	const failure = (caught: unknown, frame: Frame) => {
		if (!current(frame)) return
		setResult(null)
		if (
			caught instanceof AuthenticatedApiError &&
			['unauthorized', 'forbidden'].includes(caught.kind)
		)
			setDenied(true)
		const message =
			caught instanceof AuthenticatedApiError
				? caught.message
				: 'Поиск реквизитов временно недоступен.'
		setError(message)
		toast.error(message)
	}
	const search = async () => {
		if (!canWrite || denied || active.current || !session) return
		if (!isLookupInn(inn)) {
			const message =
				'Проверьте ИНН: нужны 10 или 12 цифр с корректной контрольной суммой.'
			setError(message)
			toast.error(message)
			return
		}
		const frame = capture()
		active.current = true
		setBusy(true)
		setResult(null)
		setError(null)
		setReplace(false)
		try {
			if (!(await authorize(frame))) return
			const received = await lookupCompany(
				frame.token!,
				frame.workspaceId,
				frame.inn
			)
			if (!current(frame) || received.inn !== frame.inn) return
			setResult(received)
			toast(
				received.items.length
					? 'Реквизиты найдены. Проверьте их перед заполнением формы.'
					: 'По этому ИНН ничего не найдено. Можно заполнить поля вручную.'
			)
		} catch (caught) {
			failure(caught, frame)
		} finally {
			if (current(frame)) {
				active.current = false
				setBusy(false)
			}
		}
	}
	const apply = async (item: CompanyLookupItem) => {
		if (
			!canWrite ||
			denied ||
			active.current ||
			!result?.items.includes(item) ||
			result.inn !== inn ||
			item.inn !== inn ||
			(item.entityType === 'INDIVIDUAL' && hasKpp && !replace)
		)
			return
		const frame = capture(),
			overwrite = replace
		active.current = true
		setBusy(true)
		setError(null)
		try {
			if (!(await authorize(frame)) || !current(frame)) return
			if (
				item.entityType === 'INDIVIDUAL' &&
				latest.current.hasKpp &&
				!overwrite
			)
				return
			const applied = latest.current.onApply(item, overwrite)
			toast(
				applied
					? 'Форма заполнена. Проверьте реквизиты и нажмите «Сохранить».'
					: 'Заполненные поля сохранены. Для замены разрешите перезапись.'
			)
		} catch (caught) {
			failure(caught, frame)
		} finally {
			if (current(frame)) {
				active.current = false
				setBusy(false)
			}
		}
	}
	if (!canWrite) return null
	return (
		<section
			className={styles.lookup}
			aria-label="Поиск реквизитов по ИНН"
		>
			<Button
				variant="secondary"
				isLoading={busy}
				disabled={denied || !session}
				onClick={() => void search()}
			>
				Найти реквизиты
			</Button>
			<p className={styles.hint}>
				Поиск выполняется только по кнопке. Данные можно заполнить вручную;
				сохранение — отдельным действием.
			</p>
			{error && (
				<p role="alert" className={styles.lookupError}>
					{error} Ручное заполнение остаётся доступным.
				</p>
			)}
			{result && !denied && result.inn === inn && (
				<>
					{result.items.length === 0 ? (
						<p role="status" className={styles.hint}>
							По этому ИНН ничего не найдено.
						</p>
					) : (
						<>
							{hasExisting && (
								<label className={styles.lookupCheckbox}>
									<input
										type="checkbox"
										checked={replace}
										disabled={busy}
										onChange={event => {
											setReplace(event.target.checked)
											toast(
												event.target.checked
													? 'Замена заполненных реквизитов разрешена.'
													: 'Будут заполнены только пустые поля.'
											)
										}}
									/>
									<span>
										Заменить уже заполненные реквизиты, включая очистку КПП
										для ИП
									</span>
								</label>
							)}
							{result.items.map((item, index) => (
								<article
									className={styles.lookupCard}
									key={`${item.inn}:${item.kpp}:${index}`}
								>
									<div className={styles.lookupHeading}>
										<h3>{item.name}</h3>
										<StatusBadge
											tone={
												item.status === 'ACTIVE' ? 'success' : 'warning'
											}
										>
											{statusLabels[item.status]}
										</StatusBadge>
									</div>
									<p>{item.legalName}</p>
									<dl>
										<div>
											<dt>Тип</dt>
											<dd>
												{item.entityType === 'LEGAL'
													? 'Юридическое лицо'
													: 'Индивидуальный предприниматель'}
											</dd>
										</div>
										<div>
											<dt>ИНН</dt>
											<dd>{item.inn}</dd>
										</div>
										<div>
											<dt>КПП</dt>
											<dd>{item.kpp ?? 'Не указан'}</dd>
										</div>
										<div>
											<dt>
												{item.entityType === 'INDIVIDUAL'
													? 'ОГРНИП'
													: 'ОГРН'}
											</dt>
											<dd>{item.ogrn ?? 'Не указан'}</dd>
										</div>
										<div>
											<dt>Адрес</dt>
											<dd>{item.legalAddress ?? 'Не указан'}</dd>
										</div>
									</dl>
									{item.status !== 'ACTIVE' && (
										<p className={styles.lookupWarning}>
											Статус требует внимания. Проверьте актуальность
											сведений перед использованием.
										</p>
									)}
									{item.entityType === 'INDIVIDUAL' &&
										hasKpp &&
										!replace && (
											<p className={styles.lookupWarning}>
												У ИП нет КПП. Для очистки введённого КПП явно
												разрешите замену реквизитов.
											</p>
										)}
									<Button
										variant="secondary"
										disabled={
											busy ||
											(item.entityType === 'INDIVIDUAL' &&
												hasKpp &&
												!replace)
										}
										onClick={() => void apply(item)}
									>
										Заполнить форму
									</Button>
								</article>
							))}
							<p className={styles.hint}>
								Реквизиты получены{' '}
								{new Date(result.queriedAt).toLocaleString('ru-RU')}. Сайт
								и заметки не изменяются.
							</p>
						</>
					)}
				</>
			)}
		</section>
	)
}
