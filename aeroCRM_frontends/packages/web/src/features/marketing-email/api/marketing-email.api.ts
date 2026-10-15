import { axiosInterceptorsRequest } from '@/shared/api'
import {
	actorBoundMutation,
	type MutationActor
} from '@/shared/api/actor-bound-mutation'
import {
	parseMarketingEmailView,
	parseMarketingEmailCommand,
	type MarketingEmailCommand
} from '../model/marketing-email.contract'

const BASE = '/users/profile/marketing-email'

export const marketingEmailService = {
	async get() {
		const { data } = await axiosInterceptorsRequest.get<unknown>(BASE, {
			timeout: 15_000
		})
		return parseMarketingEmailView(data)
	},
	async save(actor: MutationActor, command: MarketingEmailCommand) {
		const result = parseMarketingEmailView(
			await actorBoundMutation(
				actor,
				BASE,
				parseMarketingEmailCommand(command)
			)
		)
		if (
			result.version !== command.expectedVersion + 1 ||
			result.enabled !== command.enabled ||
			result.emailBinding !== command.expectedEmailBinding
		)
			throw new Error('Не удалось подтвердить сохранение согласия.')
		return result
	}
}
