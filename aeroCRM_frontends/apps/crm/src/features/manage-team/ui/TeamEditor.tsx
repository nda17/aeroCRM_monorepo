'use client'

import {
	listTeamRecords,
	crmRoleLabels,
	crmRoles,
	normalizeEmployeeName,
	type EmployeeName,
	type CrmRole,
	type TeamMutation,
	type CustomRoleInput,
	type CrmCustomRoleRow,
	type RoleAssignment,
	type TeamRow
} from '@/entities/crm-team'
import { Button, Drawer, SelectField, TextField } from '@/shared/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import { CustomRoleFields } from './CustomRoleFields'
import {
	isCustomRoleName,
	isCustomRolePermissions,
	normalizeRoleName
} from '@/shared/lib/custom-role'
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
	'create-role': 'Новая роль',
	'update-role': 'Настройки роли',
	'archive-role': 'Архивировать роль',
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
	'update-role':
		'Название и права изменятся у всех сотрудников и действующих приглашений с этой ролью.',
	'archive-role':
		'Архивировать можно только роль без назначенных сотрудников и действующих приглашений.',
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
	const [customRoleId, setCustomRoleId] = useState(
		record && 'customRole' in record ? (record.customRole?.id ?? '') : ''
	)
	const [roleInput, setRoleInput] = useState<CustomRoleInput>(
		record?.kind === 'role'
			? {
					name: record.name,
					permissions: record.permissions,
					dataScope: record.dataScope
				}
			: { name: '', permissions: [], dataScope: 'OWN' }
	)
	const [impactConfirmed, setImpactConfirmed] = useState(false)
	const [roleNameAtSubmit, setRoleNameAtSubmit] = useState('')
	const owner = context.permissions.data?.role === 'OWNER'
	const roleChoices = useInfiniteQuery({
		queryKey: ['crm-role-options', ...context.key],
		enabled:
			owner &&
			context.canRead &&
			['invite', 'role'].includes(selection.kind),
		initialPageParam: 1,
		queryFn: ({ pageParam }) =>
			listTeamRecords(
				context.session!.accessToken,
				context.workspace.workspaceId,
				'roles',
				pageParam,
				100
			),
		getNextPageParam: last =>
			last.page * last.pageSize < last.total ? last.page + 1 : undefined,
		retry: false,
		staleTime: 0,
		gcTime: 0
	})
	const customRoles =
		roleChoices.data?.pages
			.flatMap(page => page.items)
			.filter((row): row is CrmCustomRoleRow => row.kind === 'role') ?? []
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
	const roleOperation = [
		'create-role',
		'update-role',
		'archive-role'
	].includes(kind)
	const locked = command.locked || reviewing || (roleOperation && !owner)
	const roleNameError =
		command.error?.kind === 'validation' &&
		command.error.message.endsWith('Выберите другое название.')
			? command.error.message
			: undefined
	const assignment = (): RoleAssignment => {
		if (role !== 'CUSTOM') return { role }
		const selectedRole = customRoles.find(item => item.id === customRoleId)
		if (
			!owner ||
			!selectedRole ||
			roleChoices.isError ||
			roleChoices.isFetching
		)
			throw new Error('Обновите список ролей и выберите действующую роль.')
		return {
			role,
			customRoleId: selectedRole.id,
			expectedRoleVersion: selectedRole.version
		}
	}
	const prepare = (): TeamMutation => {
		if (kind === 'create-role')
			return {
				kind,
				...roleInput,
				name: normalizeRoleName(roleInput.name)
			}
		if (kind === 'create-team') return { kind, name: name.trim() }
		if (kind === 'invite')
			return {
				kind,
				email: email.trim().toLowerCase(),
				...assignment(),
				teamIds,
				ttlDays: 7,
				profile: normalizeEmployeeName(profile)!
			}
		if (!record) throw new Error('Нет записи для команды')
		const versioned = { id: record.id, expectedVersion: record.version }
		if (kind === 'update-role')
			return {
				kind,
				...versioned,
				...roleInput,
				name: normalizeRoleName(roleInput.name)
			}
		if (kind === 'archive-role') return { kind, ...versioned }
		if (kind === 'rename-team')
			return { kind, ...versioned, name: name.trim() }
		if (kind === 'role') return { kind, ...versioned, ...assignment() }
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
		if (locked) return
		if (
			['create-role', 'update-role'].includes(kind) &&
			(!isCustomRoleName(normalizeRoleName(roleInput.name)) ||
				!isCustomRolePermissions(roleInput.permissions))
		) {
			toast.error(
				'Укажите название на русском с заглавной буквы и разрешите хотя бы один раздел.'
			)
			return
		}
		if (
			kind === 'update-role' &&
			record?.kind === 'role' &&
			record.memberCount + record.invitationCount > 0 &&
			!impactConfirmed
		) {
			toast.error('Подтвердите изменение прав сотрудников с этой ролью.')
			return
		}
		try {
			if (kind === 'create-role' || kind === 'update-role')
				setRoleNameAtSubmit(roleInput.name)
			void command.execute(prepare())
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Проверьте выбранную роль'
			)
		}
	}
	const review = async () => {
		setReviewing(true)
		try {
			const fresh = await onReview()
			if (owner && (kind === 'invite' || kind === 'role')) {
				const roles = await roleChoices.refetch()
				if (roles.isError) throw new Error('Не удалось обновить роли')
			}
			if (record && !fresh) {
				toast.error(
					'Запись отсутствует на текущей странице. Закройте форму и откройте актуальную запись.'
				)
				return
			}
			if (fresh) {
				setRecord(fresh)
				if (fresh.kind === 'role') {
					setRoleInput({
						name: fresh.name,
						permissions: fresh.permissions,
						dataScope: fresh.dataScope
					})
					setImpactConfirmed(false)
				}
				if ('customRole' in fresh)
					setCustomRoleId(fresh.customRole?.id ?? '')
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
								: record.kind === 'team' || record.kind === 'role'
									? record.name
									: `Обработка ${record.consumer}`}
					</div>
				) : null}
				{['create-role', 'update-role'].includes(kind) ? (
					<CustomRoleFields
						value={roleInput}
						nameError={
							roleInput.name === roleNameAtSubmit
								? roleNameError
								: undefined
						}
						onChange={value => {
							setRoleInput(value)
							setImpactConfirmed(false)
						}}
						disabled={locked}
					/>
				) : null}
				{kind === 'update-role' &&
				record?.kind === 'role' &&
				record.memberCount + record.invitationCount > 0 ? (
					<label className={styles.check}>
						<input
							type="checkbox"
							checked={impactConfirmed}
							disabled={locked}
							onChange={event => setImpactConfirmed(event.target.checked)}
						/>
						<span>
							Изменить права всех сотрудников с этой ролью:{' '}
							{record.memberCount}. Действующих приглашений:{' '}
							{record.invitationCount}.
						</span>
					</label>
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
							value={role === 'CUSTOM' ? `custom:${customRoleId}` : role}
							onChange={event => {
								const value = event.target.value
								if (value.startsWith('custom:')) {
									setRole('CUSTOM')
									setCustomRoleId(value.slice(7))
								} else {
									setRole(value as CrmRole)
									setCustomRoleId('')
								}
							}}
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
							{role === 'CUSTOM' &&
							!customRoles.some(item => item.id === customRoleId) ? (
								<option value={`custom:${customRoleId}`} disabled>
									{record && 'customRole' in record
										? (record.customRole?.name ?? 'Выберите роль')
										: 'Выберите роль'}
								</option>
							) : null}
							{owner
								? customRoles.map(item => (
										<option key={item.id} value={`custom:${item.id}`}>
											{item.name}
										</option>
									))
								: null}
						</SelectField>
						{owner && roleChoices.isError ? (
							<div role="alert" className={styles.error}>
								Не удалось загрузить собственные роли.
								<Button
									variant="secondary"
									onClick={() => void roleChoices.refetch()}
								>
									Повторить
								</Button>
							</div>
						) : null}
						{owner && roleChoices.hasNextPage ? (
							<Button
								variant="secondary"
								disabled={roleChoices.isFetching}
								onClick={() => void roleChoices.fetchNextPage()}
							>
								Ещё роли
							</Button>
						) : null}
						<p className={styles.muted}>
							{role === 'CUSTOM'
								? 'Права и область данных определяются выбранной ролью. Владелец может изменить их в разделе «Роли».'
								: 'Руководитель видит данные своих отделов, менеджер — свои записи, аналитик — агрегированные показатели без персональных данных.'}
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
				{command.error && !roleNameError ? (
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
