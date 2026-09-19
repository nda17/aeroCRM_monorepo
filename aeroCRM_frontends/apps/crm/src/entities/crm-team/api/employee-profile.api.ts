import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	normalizeEmployeeName,
	parseEmployeeProfile,
	type EmployeeProfileCommand,
	type EmployeeProfileRequest
} from '../model/employee-profile.contract'

export const getEmployeeProfile = async (
	accessToken: string,
	request: EmployeeProfileRequest
) => {
	const result = parseEmployeeProfile(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/access/team/profiles',
			params: {
				workspaceId: request.workspaceId,
				subject: request.targetSubject
			}
		}),
		request
	)
	if (!result) throw invalidContractError()
	return result
}

export const updateEmployeeProfile = async (
	accessToken: string,
	command: EmployeeProfileCommand
) => {
	const result = parseEmployeeProfile(
		await authenticatedRequest({
			accessToken,
			method: 'POST',
			url: '/crm/access/team/profiles',
			headers: { 'Idempotency-Key': command.commandId },
			data: {
				schemaVersion: 1,
				commandId: command.commandId,
				workspaceId: command.workspaceId,
				subject: command.targetSubject,
				expectedVersion: command.expectedVersion,
				profile: command.profile
			}
		}),
		command
	)
	const expected = normalizeEmployeeName(command.profile)
	if (
		!result?.profile ||
		!expected ||
		result.profile.version !== command.expectedVersion + 1 ||
		result.profile.firstName !== expected.firstName ||
		result.profile.lastName !== expected.lastName ||
		result.profile.middleName !== expected.middleName
	)
		throw invalidContractError()
	return result
}
