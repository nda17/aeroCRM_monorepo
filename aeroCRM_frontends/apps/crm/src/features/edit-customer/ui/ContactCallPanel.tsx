'use client'

import {
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore
} from 'react'
import toast from 'react-hot-toast'
import {
	getCustomer,
	validContactCallPreferences,
	type ContactCallPreferences,
	type Customer
} from '@/entities/customer'
import { getCrmPermissions } from '@/entities/crm-access'
import { useSessionStore } from '@/entities/session'
import {
	browserWorkdayTimeZones,
	workdayTimeZoneGroups,
	isIanaTimeZone
} from '@/shared/lib/time-zones'
import { Button, SelectField, TextField } from '@/shared/ui'
import { contactCallState, openContactDialer } from '../model/contact-call'
import styles from './CustomerEditor.module.scss'

const subscribe = (listener: () => void) => {
	const timer = window.setInterval(listener, 60000)
	return () => window.clearInterval(timer)
}
const clockSnapshot = () => Math.floor(Date.now() / 60000) * 60000
const serverSnapshot = () => 0
const preferencesOf = (record: Customer): ContactCallPreferences =>
	record.kind === 'contacts'
		? {
				timeZone: record.timeZone ?? null,
				preferredCallStart: record.preferredCallStart ?? null,
				preferredCallEnd: record.preferredCallEnd ?? null
			}
		: { timeZone: null, preferredCallStart: null, preferredCallEnd: null }

export const ContactCallPanel = ({
	value,
	onChange,
	editable,
	disabled,
	record
}: {
	value: ContactCallPreferences
	onChange: (field: keyof ContactCallPreferences, value: string) => void
	editable: boolean
	disabled: boolean
	record?: Customer
}) => {
	const session = useSessionStore(state => state.session)
	const revision = useSessionStore(state => state.sessionRevision)
	const [calling, setCalling] = useState(false)
	const callingRef = useRef(false)
	const live = useRef({ mounted: true, disabled })
	useLayoutEffect(() => {
		live.current = { mounted: true, disabled }
		return () => {
			live.current.mounted = false
		}
	}, [disabled])
	const now = useSyncExternalStore(
		subscribe,
		clockSnapshot,
		serverSnapshot
	)
	const hydrated = now !== 0
	const zones = useMemo(
		() => (hydrated ? browserWorkdayTimeZones() : null),
		[hydrated]
	)
	const groups = useMemo(
		() => workdayTimeZoneGroups(value.timeZone ?? '', zones),
		[value.timeZone, zones]
	)
	const saved = record ? preferencesOf(record) : null
	const state =
		saved && now ? contactCallState(saved, new Date(now)) : null
	const current = () => {
		const store = useSessionStore.getState()
		return (
			live.current.mounted &&
			!live.current.disabled &&
			!!session &&
			store.session?.accessToken === session.accessToken &&
			store.session?.userId === session.userId &&
			store.sessionRevision === revision
		)
	}
	const call = async () => {
		if (
			!current() ||
			callingRef.current ||
			record?.kind !== 'contacts' ||
			!record.phone
		)
			return
		callingRef.current = true
		setCalling(true)
		try {
			const permissions = await getCrmPermissions(
				session!.accessToken,
				record.workspaceId
			)
			if (!current()) return
			if (
				permissions.subject !== session!.userId ||
				permissions.workspaceId !== record.workspaceId ||
				!permissions.permissions.includes('customers:read')
			)
				throw Error('Нет доступа к контакту')
			const fresh = await getCustomer(
				session!.accessToken,
				'contacts',
				record.workspaceId,
				record.id
			)
			if (!current()) return
			if (
				fresh.kind !== 'contacts' ||
				fresh.id !== record.id ||
				fresh.version !== record.version ||
				fresh.phone !== record.phone
			)
				throw Error('Карточка изменилась. Обновите её перед звонком.')
			const preferences = preferencesOf(fresh)
			let check = contactCallState(preferences, new Date())
			const confirm = () =>
				window.confirm(
					check.status === 'UNKNOWN'
						? 'Часовой пояс или удобные часы клиента не указаны. Время для звонка неизвестно. Всё равно позвонить?'
						: `У клиента сейчас ${check.clock}. Удобные часы: ${preferences.preferredCallStart}–${preferences.preferredCallEnd}. Сейчас вне этого интервала. Всё равно позвонить?`
				)
			if (check.status !== 'ALLOWED' && !confirm()) {
				toast('Звонок отменён')
				return
			}
			const previous = check.status
			check = contactCallState(preferences, new Date())
			if (
				previous === 'ALLOWED' &&
				check.status !== 'ALLOWED' &&
				!confirm()
			) {
				toast('Звонок отменён')
				return
			}
			if (!current()) return
			toast('Открываем приложение для звонка')
			openContactDialer(fresh.phone!)
		} catch (error) {
			if (current())
				toast.error(
					error instanceof Error
						? error.message
						: 'Не удалось проверить контакт'
				)
		} finally {
			callingRef.current = false
			if (live.current.mounted) setCalling(false)
		}
	}
	return (
		<section
			className={styles.callPanel}
			aria-label="Время для связи с клиентом"
		>
			<SelectField
				label="Часовой пояс клиента"
				value={value.timeZone ?? ''}
				disabled={!editable}
				onChange={event => {
					if (
						event.target.value === '' ||
						isIanaTimeZone(event.target.value)
					)
						onChange('timeZone', event.target.value)
				}}
			>
				<option value="">Не указан</option>
				{groups.map(group => (
					<optgroup key={group.label} label={group.label}>
						{group.options.map(option => (
							<option
								key={option.value}
								value={option.value}
								disabled={option.disabled}
							>
								{option.label}
							</option>
						))}
					</optgroup>
				))}
			</SelectField>
			<div className={styles.callHours}>
				<TextField
					label="Удобно звонить с"
					type="time"
					value={value.preferredCallStart ?? ''}
					readOnly={!editable}
					onChange={event =>
						onChange('preferredCallStart', event.target.value)
					}
				/>
				<TextField
					label="Удобно звонить до"
					type="time"
					value={value.preferredCallEnd ?? ''}
					readOnly={!editable}
					onChange={event =>
						onChange('preferredCallEnd', event.target.value)
					}
				/>
			</div>
			<p className={styles.hint}>
				Необязательно. Часы указываются по времени клиента; интервал может
				переходить через полночь. Данные сохраняются кнопкой «Сохранить».
			</p>
			{!validContactCallPreferences(value) ? (
				<p role="alert" className={styles.lookupError}>
					Укажите часовой пояс и обе разные границы времени или очистите
					оба поля часов.
				</p>
			) : null}
			{record?.kind === 'contacts' ? (
				<>
					<p className={styles.hint}>
						По сохранённой карточке:{' '}
						{saved?.timeZone
							? `у клиента сейчас ${state?.clock ?? '—'} (${saved.timeZone})`
							: 'часовой пояс клиента не указан'}
						.{' '}
						{saved?.preferredCallStart
							? `Удобные часы: ${saved.preferredCallStart}–${saved.preferredCallEnd}.`
							: 'Удобные часы не указаны.'}
					</p>
					{state?.status === 'OUTSIDE' ? (
						<p className={styles.lookupWarning}>
							Сейчас вне удобных часов клиента.
						</p>
					) : null}
					{state?.status === 'UNKNOWN' ? (
						<p className={styles.lookupWarning}>
							Время звонка не настроено
						</p>
					) : null}
					{record.phone ? (
						<Button
							variant="secondary"
							disabled={disabled || calling || !session}
							onClick={() => void call()}
						>
							Позвонить
						</Button>
					) : null}
				</>
			) : null}
		</section>
	)
}
