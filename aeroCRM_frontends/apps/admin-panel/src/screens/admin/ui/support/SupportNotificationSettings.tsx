'use client'

import { useState } from 'react'
import {
	adminSupportApi,
	SupportAdminError,
	type SupportSettings
} from '@/features/admin-support'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import styles from './AdminSupport.module.scss'

export default function SupportNotificationSettings({
	actor,
	isDev,
	sessionReady,
	initial,
	current,
	onSaved
}: {
	actor: string
	isDev: boolean
	sessionReady: boolean
	initial: SupportSettings
	current: () => boolean
	onSaved: () => void
}) {
	const [draft, setDraft] = useState(initial)
	const [emails, setEmails] = useState(initial.staffEmails.join('\n'))
	const [pending, setPending] = useState<
		Parameters<typeof adminSupportApi.saveSettings>[1] | null
	>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [conflict, setConflict] = useState(false)
	const save = async () => {
		if (!isDev || !sessionReady || busy || conflict || !current()) return
		try {
			const staffEmails = emails
				.split(/[\n,;]/)
				.map(item => item.trim())
				.filter(Boolean)
			if (
				staffEmails.length > 10 ||
				staffEmails.some(
					email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
				)
			)
				throw new Error('Укажите до 10 корректных email.')
			if (
				draft.telegramEnabled &&
				(!draft.telegramChatId ||
					!/^-?\d{1,20}$/.test(draft.telegramChatId))
			)
				throw new Error('Укажите корректный ID Telegram-группы.')
			const command = pending ?? {
				commandId: crypto.randomUUID(),
				expectedActorSubject: actor,
				expectedVersion: draft.version,
				enabled: draft.enabled,
				emailEnabled: draft.emailEnabled,
				staffEmails,
				telegramEnabled: draft.telegramEnabled,
				telegramChatId: draft.telegramChatId,
				telegramThreadId: draft.telegramThreadId,
				clientEmailEnabled: draft.clientEmailEnabled
			}
			setPending(command)
			setBusy(true)
			setError('')
			const result = await adminSupportApi.saveSettings(actor, command)
			if (!current()) return
			setDraft(result)
			setEmails(result.staffEmails.join('\n'))
			setPending(null)
			onSaved()
			setError('')
		} catch (error) {
			if (!current()) return
			const message =
				error instanceof Error
					? error.message
					: 'Не удалось сохранить настройки.'
			setError(message)
			if (error instanceof SupportAdminError && error.status === 409)
				setConflict(true)
			if (
				error instanceof SupportAdminError &&
				[400, 403].includes(error.status ?? 0)
			)
				setPending(null)
		} finally {
			if (current()) setBusy(false)
		}
	}
	const refresh = async () => {
		if (busy || !current()) return
		try {
			const fresh = await adminSupportApi.settings(actor)
			if (!current()) return
			setDraft(fresh)
			setEmails(fresh.staffEmails.join('\n'))
			setPending(null)
			setConflict(false)
			setError('')
		} catch {
			if (current()) setError('Не удалось обновить настройки')
		}
	}
	const toggle = (
		key:
			| 'enabled'
			| 'emailEnabled'
			| 'telegramEnabled'
			| 'clientEmailEnabled',
		label: string
	) => (
		<label className={styles.checkbox}>
			<input
				type="checkbox"
				checked={draft[key]}
				onChange={event =>
					setDraft(value => ({ ...value, [key]: event.target.checked }))
				}
			/>
			{label}
		</label>
	)
	return (
		<details className={styles.settings}>
			<summary>Настройки уведомлений</summary>
			<p className={styles.hint}>
				Отправитель Telegram: Support bot. Уведомления содержат номер
				обращения и ссылку. Переписка и файлы не пересылаются.
			</p>
			<dl className={styles.summary}>
				<dt>Уведомления</dt>
				<dd>{initial.enabled ? 'Включены' : 'Выключены'}</dd>
				<dt>Email команды</dt>
				<dd>
					{initial.emailEnabled
						? initial.staffEmails.join(', ') || 'Не заданы'
						: 'Выключен'}
				</dd>
				<dt>Telegram группы / темы</dt>
				<dd>
					{initial.telegramEnabled
						? `${initial.telegramChatId || 'Не задана'} / ${initial.telegramThreadId ?? 'Общая'}`
						: 'Выключен'}
				</dd>
				<dt>Письма клиентам</dt>
				<dd>{initial.clientEmailEnabled ? 'Включены' : 'Выключены'}</dd>
			</dl>
			{!isDev && (
				<p className={styles.lockedNotice}>
					Редактирование доступно DEV{' '}
					<AdminTooltip
						title="Технические настройки"
						description="ADMIN видит действующие получатели и состояние каналов. Менять технические настройки может только DEV; сервер проверяет право при сохранении."
					/>
				</p>
			)}
			<form
				onSubmit={event => {
					event.preventDefault()
					void save()
				}}
			>
				<fieldset
					disabled={
						!isDev || !sessionReady || busy || !!pending || conflict
					}
					className={!isDev ? styles.lockedEditor : styles.settingsFields}
				>
					{toggle('enabled', 'Включить уведомления веб-поддержки')}
					{toggle('emailEnabled', 'Email команде')}
					<label>
						Email команды, по одному в строке
						<textarea
							aria-label="Email команды"
							rows={3}
							value={emails}
							onChange={event => setEmails(event.target.value)}
						/>
					</label>
					{toggle('telegramEnabled', 'Telegram команде')}
					<label>
						ID Telegram-группы
						<input
							value={draft.telegramChatId ?? ''}
							onChange={event =>
								setDraft(value => ({
									...value,
									telegramChatId: event.target.value || null
								}))
							}
						/>
					</label>
					<label>
						ID темы, необязательно
						<input
							type="number"
							min={1}
							max={2147483647}
							value={draft.telegramThreadId ?? ''}
							onChange={event =>
								setDraft(value => ({
									...value,
									telegramThreadId: event.target.value
										? Number(event.target.value)
										: null
								}))
							}
						/>
					</label>
					{toggle(
						'clientEmailEnabled',
						'Письмо клиенту после ответа оператора'
					)}
				</fieldset>
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				{isDev && (
					<div className={styles.actions}>
						<button
							className={styles.primary}
							disabled={busy || conflict || !sessionReady}
							type="submit"
						>
							{busy
								? 'Сохраняем…'
								: pending
									? 'Повторить сохранение'
									: 'Сохранить настройки'}
						</button>
						{conflict && (
							<button type="button" onClick={() => void refresh()}>
								Загрузить актуальные настройки
							</button>
						)}
					</div>
				)}
			</form>
		</details>
	)
}
