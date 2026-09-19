import { useSessionStore } from '@/entities/session'
import axios from 'axios'
import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import {
	parseWorkdayCommandResult,
	parseWorkdayTaskPage,
	parseWorkdayTaskResult,
	parseWorkdayTimelinePage,
	validWorkdayBinding,
	validWorkdayCommand,
	validWorkdayFilters,
	validWorkdayPagination
} from '../model/workday.contract'
import type {
	WorkdayBinding,
	WorkdayCommand,
	WorkdayListRequest,
	WorkdayPagination
} from '../model/workday.types'

const root = '/crm/sales/workday/tasks'
const taskCommandError = (error: unknown) => {
	if (!axios.isAxiosError(error) || error.response?.status !== 409) return
	// Use only known server codes, never upstream message text or request data.
	const code: unknown = error.response.data?.code
	const message =
		code === 'crm_task_version_conflict'
			? 'Задача уже изменилась. Обновите данные и повторите изменение.'
			: code === 'crm_task_deal_closed'
				? 'Связанная сделка закрыта. Сначала верните сделку в работу, затем измените задачу.'
				: code === 'crm_task_command_conflict'
					? 'Этот запрос уже обработан с другими параметрами. Обновите данные задачи.'
					: undefined
	return message
		? new AuthenticatedApiError('conflict', message)
		: undefined
}
const checked = <T>(value: T | null): T => {
	if (value === null) throw invalidContractError()
	return value
}
const valid = (condition: boolean) => {
	if (!condition)
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте параметры задачи или периода.'
		)
}
export const listWorkdayTasks = async (
	accessToken: string,
	request: WorkdayListRequest
) => {
	valid(validWorkdayBinding(request) && validWorkdayFilters(request))
	const {
		workspaceId,
		page,
		pageSize,
		scope,
		period,
		timeZone,
		teamId,
		assigneeSubject,
		search,
		status,
		from,
		to
	} = request
	return checked(
		parseWorkdayTaskPage(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: root,
				params: {
					workspaceId,
					page: String(page),
					pageSize: String(pageSize),
					scope,
					period,
					timeZone,
					...(teamId !== undefined ? { teamId } : {}),
					...(assigneeSubject !== undefined ? { assigneeSubject } : {}),
					...(search !== undefined ? { search } : {}),
					...(status !== undefined ? { status } : {}),
					...(from !== undefined ? { from } : {}),
					...(to !== undefined ? { to } : {})
				}
			}),
			request
		)
	)
}
export const getWorkdayTask = async (
	accessToken: string,
	request: WorkdayBinding & { id: string }
) => {
	valid(validWorkdayBinding(request) && isUuidV4(request.id))
	return checked(
		parseWorkdayTaskResult(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${root}/${request.id}`,
				params: { workspaceId: request.workspaceId }
			}),
			request.workspaceId,
			request.id
		)
	)
}
export const listWorkdayTimeline = async (
	accessToken: string,
	request: WorkdayBinding & WorkdayPagination & { id: string }
) => {
	valid(
		validWorkdayBinding(request) &&
			isUuidV4(request.id) &&
			validWorkdayPagination(request)
	)
	return checked(
		parseWorkdayTimelinePage(
			await authenticatedRequest({
				accessToken,
				method: 'GET',
				url: `${root}/${request.id}/timeline`,
				params: {
					workspaceId: request.workspaceId,
					page: String(request.page),
					pageSize: String(request.pageSize)
				}
			}),
			request
		)
	)
}

/** In-memory immutable retry capsule. Do not persist task text or credentials. */
export const freezeWorkdayCommand = (
	command: WorkdayCommand
): WorkdayCommand => {
	valid(validWorkdayCommand(command))
	const mutation = command.mutation
	return Object.freeze({
		...command,
		mutation: Object.freeze({
			...mutation,
			...('assignee' in mutation
				? { assignee: Object.freeze({ ...mutation.assignee }) }
				: {})
		})
	})
}
export const mutateWorkdayTask = async (
	accessToken: string,
	command: WorkdayCommand
) => {
	const captured = freezeWorkdayCommand(command)
	const current = useSessionStore.getState()
	// This is stale-UI protection, not token verification or authorization.
	// The backend independently authorizes the pinned bearer on every attempt.
	if (
		current.status !== 'authenticated' ||
		current.session?.accessToken !== accessToken ||
		current.session.userId !== captured.subject ||
		current.sessionRevision !== captured.sessionRevision
	)
		throw new AuthenticatedApiError(
			'unauthorized',
			'Сессия изменилась. Команда не отправлена.'
		)
	const mutation = captured.mutation
	const common = {
		schemaVersion: 1,
		commandId: captured.commandId,
		workspaceId: captured.workspaceId
	}
	let data: unknown
	if (mutation.kind === 'create')
		data = {
			...common,
			title: mutation.title,
			dueAt: mutation.dueAt,
			assignee: mutation.assignee,
			...(mutation.dealId !== null ? { dealId: mutation.dealId } : {}),
			...(mutation.teamId !== null ? { teamId: mutation.teamId } : {})
		}
	else {
		const versioned = {
			...common,
			expectedVersion: mutation.expectedVersion
		}
		data =
			mutation.kind === 'edit'
				? { ...versioned, title: mutation.title, dueAt: mutation.dueAt }
				: mutation.kind === 'status'
					? { ...versioned, status: mutation.status }
					: { ...versioned, assignee: mutation.assignee }
	}
	return checked(
		parseWorkdayCommandResult(
			await authenticatedRequest({
				accessToken,
				method: 'POST',
				url:
					mutation.kind === 'create'
						? root
						: `${root}/${mutation.id}/${mutation.kind}`,
				headers: { 'Idempotency-Key': captured.commandId },
				data,
				mapError: taskCommandError
			}),
			captured
		)
	)
}
