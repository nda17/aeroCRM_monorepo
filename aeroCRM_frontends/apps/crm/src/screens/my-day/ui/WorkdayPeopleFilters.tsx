'use client'

import { forwardRef, useImperativeHandle } from 'react'
import toast from 'react-hot-toast'
import {
	AssigneeSelect,
	TeamSelect,
	useAssigneeOptions,
	useTeamOptions,
	type AssigneeDirectoryContext
} from '@/entities/crm-team'
import type { WorkdayScope } from '@/entities/crm-workday'
import { Button } from '@/shared/ui'
import styles from './WorkdayPeopleFilters.module.scss'

export interface WorkdayPeopleFilterValue {
	teamId?: string
	assigneeSubject?: string
}
export interface WorkdayPeopleFiltersHandle {
	resolve: () => WorkdayPeopleFilterValue | null
}
interface Props {
	context: AssigneeDirectoryContext
	scope: WorkdayScope
	value: WorkdayPeopleFilterValue
	onChange: (value: WorkdayPeopleFilterValue) => void
}

export const WorkdayPeopleFilters = forwardRef<
	WorkdayPeopleFiltersHandle,
	Props
>(({ context, scope, value, onChange }, ref) => {
	const authority = context.authority
	const permitted =
		context.canRead &&
		authority?.subject === context.subject &&
		authority?.workspaceId === context.workspaceId &&
		authority?.role !== 'ANALYST' &&
		authority?.permissions.includes('sales:read') === true &&
		(scope === 'MINE' ||
			(scope === 'TEAM' && authority.dataScope !== 'OWN') ||
			(scope === 'ALL' && authority.dataScope === 'ALL'))
	const current = () => permitted && context.isCurrent()
	const browsing = permitted && scope !== 'MINE'
	const teams = useTeamOptions(
		{
			workspaceId: context.workspaceId,
			subject: context.subject,
			accessToken: context.accessToken,
			sessionRevision: context.sessionRevision,
			permissionScope: JSON.stringify([authority, scope]),
			teamIds: authority?.teamIds ?? [],
			enabled: browsing,
			isCurrent: current
		},
		value.teamId ?? ''
	)
	const teamConfirmed =
		!value.teamId ||
		(teams.validSelection && !teams.loading && !teams.error)
	const assignees = useAssigneeOptions(
		{
			...context,
			canRead: browsing && teamConfirmed,
			isCurrent: () => current() && scope !== 'MINE'
		},
		{
			selectedSubject: value.assigneeSubject,
			teamId: value.teamId
		}
	)
	// A filter is subject-based, not an assignment command. Resolve its label
	// from the exact server-selected binding; never guess a membership or row.
	const selected =
		assignees.selected?.subject === value.assigneeSubject
			? assignees.selected
			: null
	useImperativeHandle(ref, () => ({
		resolve: () => {
			if (!current()) return null
			// Only explicit form submission clears previously drafted people filters.
			// It never promotes MINE to TEAM/ALL to make an employee selection match.
			if (scope === 'MINE') return {}
			if (!teamConfirmed) return null
			if (
				value.teamId &&
				(!teams.data || !authority?.teamIds.includes(value.teamId))
			)
				return null
			if (
				value.assigneeSubject &&
				(!selected || !assignees.resolveBinding(selected))
			)
				return null
			return {
				...(value.teamId ? { teamId: value.teamId } : {}),
				...(value.assigneeSubject
					? { assigneeSubject: value.assigneeSubject }
					: {})
			}
		}
	}))
	if (scope === 'MINE')
		return (
			<p className={styles.hint}>
				В режиме «Мои задачи» показываются только ваши задачи. Фильтры
				сотрудника и отдела не применяются.
			</p>
		)
	return (
		<div
			className={styles.content}
			role="group"
			aria-label="Сотрудник и отдел"
		>
			<div className={styles.field}>
				<TeamSelect
					options={teams}
					value={value.teamId ?? ''}
					label="Отдел задач"
					emptyLabel="Все отделы"
					disabled={!browsing}
					onChange={teamId => {
						if (!current()) return false
						if (
							teamId &&
							(!authority?.teamIds.includes(teamId) ||
								(!teams.data?.items.some(item => item.id === teamId) &&
									teams.data?.selected?.id !== teamId))
						)
							return false
						onChange({ ...value, teamId: teamId || undefined })
						return true
					}}
				/>
				<p className={styles.hint}>
					Выбранный отдел только сужает текущую область задач.
				</p>
			</div>
			<div className={styles.field}>
				<AssigneeSelect
					options={assignees}
					value={
						value.assigneeSubject
							? (selected ?? {
									subject: value.assigneeSubject,
									membershipId: null
								})
							: null
					}
					label="Сотрудник"
					disabled={!browsing || !teamConfirmed}
					onChange={employee => {
						if (!current() || !assignees.resolveBinding(employee)) return
						onChange({ ...value, assigneeSubject: employee.subject })
					}}
				/>
				{value.assigneeSubject ? (
					<Button
						variant="secondary"
						disabled={!browsing}
						onClick={() => {
							if (!current()) return
							onChange({ ...value, assigneeSubject: undefined })
							toast('Фильтр сотрудника сброшен')
						}}
					>
						Все сотрудники выбранной области
					</Button>
				) : (
					<p className={styles.hint}>
						Все сотрудники выбранной области. Выбор не меняет назначение
						задач.
					</p>
				)}
			</div>
		</div>
	)
})
WorkdayPeopleFilters.displayName = 'WorkdayPeopleFilters'
