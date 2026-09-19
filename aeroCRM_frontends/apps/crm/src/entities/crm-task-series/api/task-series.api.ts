import axios from 'axios'
import { useSessionStore } from '@/entities/session'
import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	parseSeriesPage,
	parseSeriesResult,
	validSeriesCommand,
	validSeriesPageRequest,
	type SeriesCommand,
	type SeriesPageRequest
} from '../model/task-series.contract'

const root = '/crm/sales/workday/task-series'
export const listTaskSeries = async (
	token: string,
	request: SeriesPageRequest
) => {
	if (!validSeriesPageRequest(request)) throw invalidContractError()
	const result = parseSeriesPage(
		await authenticatedRequest({
			accessToken: token,
			method: 'GET',
			url: root,
			params: {
				workspaceId: request.workspaceId,
				page: String(request.page),
				pageSize: String(request.pageSize),
				status: request.status,
				...(request.search ? { search: request.search } : {})
			}
		}),
		request
	)
	if (!result) throw invalidContractError()
	return result
}
export const freezeSeriesCommand = (
	input: SeriesCommand
): SeriesCommand => {
	if (!validSeriesCommand(input))
		throw new AuthenticatedApiError(
			'validation',
			'Проверьте расписание и ответственного.'
		)
	const mutation = input.mutation
	return Object.freeze({
		...input,
		mutation: Object.freeze({
			...mutation,
			...('content' in mutation
				? {
						content: Object.freeze({
							...mutation.content,
							assignee: Object.freeze({ ...mutation.content.assignee })
						})
					}
				: {})
		})
	})
}
const mapError = (error: unknown) => {
	if (!axios.isAxiosError(error) || error.response?.status !== 409) return
	const messages: Record<string, string> = {
		crm_task_series_version_conflict:
			'Серия уже изменилась. Обновите список и откройте её заново.',
		crm_task_series_command_conflict:
			'Запрос уже обработан с другими параметрами. Обновите список.',
		crm_task_series_cancelled:
			'Серия отменена. Для новых повторов создайте другую серию.',
		crm_task_series_deal_closed:
			'Связанная сделка закрыта. Новые задачи по ней не создаются.'
	}
	const code: unknown = error.response.data?.code
	if (typeof code === 'string' && Object.hasOwn(messages, code))
		return new AuthenticatedApiError('conflict', messages[code])
}
export const mutateTaskSeries = async (
	token: string,
	input: SeriesCommand
) => {
	const command = freezeSeriesCommand(input),
		session = useSessionStore.getState()
	if (
		session.status !== 'authenticated' ||
		session.session?.accessToken !== token ||
		session.session.userId !== command.subject ||
		session.sessionRevision !== command.sessionRevision
	)
		throw new AuthenticatedApiError(
			'unauthorized',
			'Сессия изменилась. Команда не отправлена.'
		)
	const m = command.mutation
	const common = {
		schemaVersion: 1,
		workspaceId: command.workspaceId,
		commandId: command.commandId,
		actorMembershipId: command.actorMembershipId
	}
	const data =
		m.kind === 'create'
			? {
					...common,
					content: m.content,
					frequency: m.frequency,
					startDate: m.startDate,
					...(m.dealId ? { dealId: m.dealId } : {}),
					...(m.teamId ? { teamId: m.teamId } : {})
				}
			: m.kind === 'edit'
				? {
						...common,
						expectedVersion: m.expectedVersion,
						content: m.content
					}
				: {
						...common,
						expectedVersion: m.expectedVersion,
						status: m.status
					}
	const result = parseSeriesResult(
		await authenticatedRequest({
			accessToken: token,
			method: 'POST',
			url: m.kind === 'create' ? root : `${root}/${m.id}/${m.kind}`,
			headers: { 'Idempotency-Key': command.commandId },
			data,
			mapError
		}),
		command
	)
	if (!result) throw invalidContractError()
	return result
}
