import {
	authenticatedRequest,
	AuthenticatedApiError,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import axios from 'axios'
import {
	parseCustomerPage,
	parseCustomerResult,
	type CustomerFields,
	type CustomerKind
} from '../model/customer.contract'

export const listCustomers = async (
	accessToken: string,
	kind: CustomerKind,
	workspaceId: string,
	page: number,
	pageSize: number,
	search: string
) => {
	const result = parseCustomerPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/customers/v2/${kind}`,
			params: {
				workspaceId,
				page: String(page),
				pageSize: String(pageSize),
				search
			}
		}),
		kind,
		workspaceId,
		page,
		pageSize,
		2
	)
	if (!result) throw invalidContractError()
	return result
}

export const getCustomer = async (
	accessToken: string,
	kind: CustomerKind,
	workspaceId: string,
	id: string
) => {
	const result = parseCustomerResult(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: `/crm/customers/v2/${kind}/${id}`,
			params: { workspaceId }
		}),
		kind,
		workspaceId,
		id,
		2
	)
	if (!result || result.archivedAt !== null) throw invalidContractError()
	return result
}

export interface CustomerMutation {
	/** Missing version belongs to the original v1 command, never upgraded on replay. */
	schemaVersion?: 1 | 2
	kind: CustomerKind
	workspaceId: string
	commandId: string
	id?: string
	expectedVersion?: number
	fields?: CustomerFields
	archive?: boolean
}

const mapCustomerMutationError = (error: unknown) => {
	if (!axios.isAxiosError(error) || error.response?.status !== 409) return
	// Only known server codes determine the message; never display response text.
	const code: unknown = error.response.data?.code
	if (code === 'crm_company_has_contacts')
		return new AuthenticatedApiError(
			'validation',
			'У компании есть активные контакты. Сначала отвяжите их от компании или архивируйте, затем повторите архивирование.'
		)
	if (code === 'crm_customer_version_conflict')
		return new AuthenticatedApiError(
			'conflict',
			'Карточка уже изменилась. Загрузите актуальную версию перед повторной попыткой.'
		)
	if (code === 'crm_customer_command_conflict')
		return new AuthenticatedApiError(
			'conflict',
			'Этот запрос уже обработан с другими данными. Загрузите актуальную версию карточки.'
		)
}

export const findCustomerDuplicates = async (
	accessToken: string,
	workspaceId: string,
	phone: string,
	email: string
) => {
	const result = parseCustomerPage(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/customers/contacts/duplicates',
			params: {
				workspaceId,
				page: '1',
				pageSize: '25',
				...(phone ? { phone } : {}),
				...(email ? { email } : {})
			}
		}),
		'contacts',
		workspaceId,
		1,
		25
	)
	if (!result) throw invalidContractError()
	return result
}

export const mutateCustomer = async (
	accessToken: string,
	command: CustomerMutation
) => {
	const {
		kind,
		workspaceId,
		commandId,
		id,
		expectedVersion,
		fields,
		archive
	} = command
	const schemaVersion = command.schemaVersion ?? 1
	if (![1, 2].includes(schemaVersion)) throw invalidContractError()
	const result = parseCustomerResult(
		await authenticatedRequest({
			accessToken,
			method: id && !archive ? 'PUT' : 'POST',
			url: `/crm/customers/${schemaVersion === 2 ? 'v2/' : ''}${kind}${id ? `/${id}` : ''}${archive ? '/archive' : ''}`,
			headers: { 'Idempotency-Key': commandId },
			mapError: mapCustomerMutationError,
			data: {
				schemaVersion,
				workspaceId,
				commandId,
				...(id ? { expectedVersion } : {}),
				...(archive ? {} : fields)
			}
		}),
		kind,
		workspaceId,
		id,
		schemaVersion
	)
	if (
		!result ||
		(archive ? result.archivedAt === null : result.archivedAt !== null)
	)
		throw invalidContractError()
	return result
}
