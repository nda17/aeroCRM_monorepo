'use client'

import {
	mutateBilling,
	recoverBillingOperation,
	type BillingMutation,
	type BillingOperation
} from '@/entities/crm-billing'
import {
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import toast from 'react-hot-toast'
import {
	commandOwner,
	useMemoryCommand
} from '@/shared/lib/pending-command'
import type { useBillingContext } from './use-billing-context'

interface BillingIntent {
	commandId: string
	mutation: BillingMutation | null
}

const confirmedOperation = (operation: BillingOperation) => {
	if (operation.state === 'PENDING')
		throw new AuthenticatedApiError(
			'temporary',
			'Операция ещё обрабатывается. Новый платёж не создавайте; проверьте результат этой же команды.'
		)
	return operation
}

export const useBillingCommand = (
	context: ReturnType<typeof useBillingContext>,
	onReference: (commandId: string) => void,
	onConfirmed: (operation: BillingOperation) => void
) => {
	const { actor } = context
	const command = useMemoryCommand<BillingIntent, BillingOperation>(
		{
			owner: commandOwner(actor.session?.userId, actor.sessionRevision),
			workspaceId: actor.workspaceId,
			view: actor.scope
		},
		'billing:operation',
		actor.enabled,
		context.authorize,
		async (token, intent) =>
			confirmedOperation(
				intent.mutation
					? await mutateBilling(token, intent.mutation)
					: await recoverBillingOperation(
							token,
							actor.workspaceId,
							intent.commandId
						)
			),
		operation => {
			if (actor.current()) onConfirmed(operation)
		},
		async (token, intent) =>
			confirmedOperation(
				await recoverBillingOperation(
					token,
					actor.workspaceId,
					intent.commandId
				)
			)
	)
	return {
		...command,
		submit: (build: (commandId: string) => BillingMutation) =>
			command.execute(() => {
				const commandId = crypto.randomUUID()
				const mutation = build(commandId)
				if (
					mutation.body.commandId !== commandId ||
					mutation.body.workspaceId !== actor.workspaceId
				)
					throw invalidContractError()
				onReference(commandId)
				return { commandId, mutation }
			}),
		recoverReference: (commandId: string) => {
			if (command.uncertain && command.snapshot.commandId !== commandId) {
				toast.error(
					'Сначала подтвердите сохранённую операцию этого рабочего пространства.'
				)
				return Promise.resolve()
			}
			return command.snapshot.commandId && command.uncertain
				? command.recover()
				: command.execute(() => ({ commandId, mutation: null }))
		}
	}
}
