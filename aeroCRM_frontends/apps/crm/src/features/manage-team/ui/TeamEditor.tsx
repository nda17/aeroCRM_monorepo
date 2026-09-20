'use client'

import {
	crmRoleLabels,
	crmRoles,
	normalizeEmployeeName,
	type EmployeeName,
	type CrmRole,
	type TeamMutation,
	type TeamRow
} from '@/entities/crm-team'
import { Button, Drawer, SelectField, TextField } from '@/shared/ui'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useTeamCommand } from '../model/use-team-command'
import type { useTeamSession } from '../model/use-team-session'
import { TeamPicker } from './TeamPicker'
import { EmployeeNameFields } from './EmployeeNameFields'
import styles from './TeamEditor.module.scss'

export interface TeamEditorSelection {
	kind: TeamMutation['kind']
	record?: TeamRow
}
const titles: Record<TeamMutation['kind'], string> = {
	invite: 'Пригласить сотрудника',
	'create-team': 'Новый отдел',
	'rename-team': 'Название отдела',
	'archive-team': 'Архивировать отдел',
	revoke: 'Отозвать приглашение',
	role: 'Изменить CRM-роль',
	teams: 'Отделы сотрудника',
	disable: 'Отключить сотрудника',
	enable: 'Запросить включение',
	retry: 'Повторить фоновую обработку'
}
const descriptions: Partial<Record<TeamMutation['kind'], string>> = {
	invite:
		'Приглашение действует 7 дней. Потребуется вход с подтверждённым email. Место выделяется только после проверки доступа и квоты.',
	'archive-team':
		'Отдел можно архивировать только после удаления всех назначений сотрудников, включая отключённых.',
	revoke:
		'Подтверждение email больше не выдаст доступ по этому приглашению. Уже активного сотрудника нужно отключать отдельно.',
	disable:
		'Доступ сотрудника к рабочему пространству будет отключён. Место освободится для очереди.',
	enable:
		'Сотрудник останется отключённым до проверки прав и появления свободного места. Ранее принятые заявки допуска имеют приоритет.',
	retry:
		'Будет повторена только эта фоновая обработка. Бизнес-операция заново проверит актуальные права.'
}
export const TeamEditor = ({
	context,
	selection,
	onClose,
	onSaved,
	onReview
}: {
	context: ReturnType<typeof useTeamSession>
	selection: TeamEditorSelection
	onClose: () => void
	onSaved: () => void
	onReview: () => Promise<TeamRow | undefined>
}) => {
	const [record, setRecord] = useState(selection.record)
	const [name, setName] = useState(
		record?.kind === 'team' ? record.name : ''
	)
	const [email, setEmail] = useState('')
	const [profile, setProfile] = useState<EmployeeName>({
		firstName: '',
		lastName: '',
		middleName: null
	})
	const [profileError, setProfileError] = useState('')
	const [role, setRole] = useState<CrmRole>(
		record && 'role' in record ? record.role : 'MANAGER'
	)
	const [teamIds, setTeamIds] = useState<string[]>(
		record && 'teamIds' in record ? record.teamIds : []
	)
	const [reviewing, setReviewing] = useState(false)
	const { kind } = selection
	const command = useTeamCommand(
		context,
		`${kind}:${record?.id ?? 'new'}`,
		['disable', 'revoke'].includes(kind),
		() => {
			onSaved()
			onClose()
		}
	)
	const locked = command.locked || reviewing
	const prepare = (): TeamMutation => {
		if (kind === 'create-team') return { kind, name: name.trim() }
		if (kind === 'invite')
			return {
				kind,
				email: email.trim().toLowerCase(),
				role,
				teamIds,
				ttlDays: 7,
				profile: normalizeEmployeeName(profile)!
			}
		if (!record) throw new Error('Нет записи для команды')
		const versioned = { id: record.id, expectedVersion: record.version }
		if (kind === 'rename-team')
			return { kind, ...versioned, name: name.trim() }
		if (kind === 'role') return { kind, ...versioned, role }
		if (kind === 'teams') return { kind, ...versioned, teamIds }
		return { kind, ...versioned }
	}
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!locked && kind === 'invite' && !normalizeEmployeeName(profile)) {
			const message =
				'Проверьте имя и фамилию: используйте буквы, пробелы, дефис или апостроф. Отчество необязательно.'
			setProfileError(message)
			toast.error(message)
			return
		}
		if (!locked) void command.execute(prepare())
	}
	const review = async () => {
		setReviewing(true)
		try {
			const fresh = await onReview()
			if (record && !fresh) {
				toast.error(
					'Запись отсутствует на текущей странице. Закройте форму и откройте актуальную запись.'
				)
				return
			}
			if (fresh) {
				setRecord(fresh)
				if (fresh.kind === 'team') setName(fresh.name)
				if ('role' in fresh) setRole(fresh.role)
				if ('teamIds' in fresh) setTeamIds(fresh.teamIds)
			}
			command.resetAfterReview()
		} catch {
			toast.error(
				'Не удалось обновить запись. Исходная команда сохранена.'
			)
		} finally {
			setReviewing(false)
		}
	}
	return (
		<Drawer
			isOpen
			onClose={() => {
				if (command.canClose()) onClose()
			}}
			title={titles[kind]}
			description={descriptions[kind]}
		>
			<form className={styles.form} onSubmit={submit}>
				{record ? (
					<div className={styles.subject}>
						{record.kind === 'member'
							? (record.displayName ??
								record.verifiedEmail ??
								'Профиль сотрудника недоступен')
							: record.kind === 'invitation'
								? record.email
								: record.kind === 'team'
									? record.name
									: `Обработка ${record.consumer}`}
					</div>
				) : null}
				{['create-team', 'rename-team'].includes(kind) ? (
					<TextField
						label="Название отдела"
						value={name}
						onChange={event => setName(event.target.value)}
						maxLength={100}
						required
						disabled={locked}
					/>
				) : null}
				{kind === 'invite' ? (
					<>
						<EmployeeNameFields
							value={profile}
							disabled={locked}
							onChange={value => {
								setProfile(value)
								setProfileError('')
							}}
						/>
						<p className={styles.muted}>
							ФИО используется в этом CRM-пространстве. Общий аккаунт
							сотрудника не изменится.
						</p>
						{profileError ? (
							<p className={styles.error} role="alert">
								{profileError}
							</p>
						) : null}
						<TextField
							label="Email сотрудника"
							type="email"
							autoComplete="off"
							maxLength={254}
							value={email}
							onChange={event => setEmail(event.target.value)}
							required
							disabled={locked}
						/>
					</>
				) : null}
				{kind === 'invite' || kind === 'role' ? (
					<>
						<SelectField
							label="CRM-роль"
							value={role}
							onChange={event => setRole(event.target.value as CrmRole)}
							disabled={locked}
						>
							{crmRoles
								.filter(
									value =>
										context.permissions.data?.role === 'OWNER' ||
										value !== 'CRM_ADMIN'
								)
								.map(value => (
									<option key={value} value={value}>
										{crmRoleLabels[value]}
									</option>
								))}
						</SelectField>
						<p className={styles.muted}>
							Руководитель видит данные своих отделов, менеджер — свои
							записи, аналитик — агрегированные показатели без персональных
							данных.
						</p>
					</>
				) : null}
				{kind === 'invite' || kind === 'teams' ? (
					<TeamPicker
						context={context}
						selected={teamIds}
						disabled={locked}
						onChange={setTeamIds}
					/>
				) : null}
				{command.error ? (
					<div className={styles.error} role="alert">
						<p>{command.error.message}</p>
						{command.uncertain ? (
							<>
								<p>
									Ответ не подтверждён. Поля заблокированы; проверка
									отправит тот же UUID и неизменённые данные.
								</p>
								<Button
									variant="secondary"
									disabled={!command.enabled || command.running}
									isLoading={command.running}
									onClick={() => void command.execute()}
								>
									Проверить результат
								</Button>
							</>
						) : command.blocked ? (
							<Button
								variant="secondary"
								isLoading={reviewing}
								onClick={() => void review()}
							>
								Перечитать и проверить
							</Button>
						) : null}
					</div>
				) : null}
				<div className={styles.actions}>
					<Button
						variant="secondary"
						onClick={() => {
							if (command.canClose()) onClose()
						}}
					>
						Отмена
					</Button>
					<Button
						type="submit"
						disabled={locked}
						isLoading={command.running}
					>
						{kind === 'enable'
							? 'Поставить в очередь'
							: kind === 'invite'
								? 'Создать приглашение'
								: kind === 'disable'
									? 'Отключить доступ'
									: kind === 'revoke'
										? 'Отозвать'
										: 'Подтвердить'}
					</Button>
				</div>
			</form>
		</Drawer>
	)
}
