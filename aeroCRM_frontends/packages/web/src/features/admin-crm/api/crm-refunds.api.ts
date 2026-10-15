import { axiosInterceptorsRequest } from '@/shared/api'
import {
	actorBoundMutation,
	type MutationActor
} from '@/shared/api/actor-bound-mutation'
import {
	parseCrmRefundPage,
	parseCrmRefundView,
	validCrmRefundCommand,
	type CrmRefundCommand,
	type CrmRefundReviewStatus,
	type CrmRefundVerificationStatus
} from '../model/crm-refunds.contract'

const BASE = '/payments/admin/crm-refunds'
const path = (id: string) => {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			id
		)
	)
		throw new Error('Некорректный возврат.')
	return `${BASE}/${id}`
}

export const crmRefundsService = {
	async list(
		page: number,
		reviewStatus?: CrmRefundReviewStatus,
		verificationStatus?: CrmRefundVerificationStatus
	) {
		const { data } = await axiosInterceptorsRequest.get<unknown>(BASE, {
			params: { page, limit: 20, reviewStatus, verificationStatus },
			timeout: 15_000
		})
		return parseCrmRefundPage(data, page, 20)
	},
	async detail(id: string) {
		const { data } = await axiosInterceptorsRequest.get<unknown>(
			path(id),
			{ timeout: 15_000 }
		)
		return parseCrmRefundView(data, id)
	},
	async command(
		actor: MutationActor,
		id: string,
		kind: 'review' | 'retry',
		command: CrmRefundCommand
	) {
		if (!validCrmRefundCommand(command, kind))
			throw new Error('Проверьте параметры команды.')
		const result = parseCrmRefundView(
			await actorBoundMutation(actor, `${path(id)}/${kind}`, command),
			id
		)
		if (
			result.version !== command.expectedVersion + 1 ||
			(kind === 'review' &&
				(result.reviewStatus !== 'REVIEWED' ||
					result.reviewedBy !== actor.subject ||
					result.reviewComment !== command.comment)) ||
			(kind === 'retry' && result.verificationStatus !== 'PENDING')
		)
			throw new Error('Не удалось подтвердить результат команды.')
		return result
	}
}
