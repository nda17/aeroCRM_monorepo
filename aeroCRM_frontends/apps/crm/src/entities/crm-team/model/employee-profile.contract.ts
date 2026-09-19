import {
	hasExactKeys,
	isIsoDate,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export interface EmployeeName {
	firstName: string
	lastName: string
	middleName: string | null
}
export interface EmployeeProfile extends EmployeeName {
	id: string
	version: number
	updatedAt: string
}
export interface EmployeeProfileRequest {
	workspaceId: string
	subject: string
	targetSubject: string
}
export interface EmployeeProfileResponse extends EmployeeProfileRequest {
	schemaVersion: 1
	profile: EmployeeProfile | null
}
export interface EmployeeProfileCommand extends EmployeeProfileRequest {
	commandId: string
	expectedVersion: number
	profile: EmployeeName
}

export const normalizeEmployeeName = (
	value: EmployeeName
): EmployeeName | null => {
	const part = (input: string) =>
		input.normalize('NFC').trim().replace(/ +/g, ' ')
	const firstName = part(value.firstName)
	const lastName = part(value.lastName)
	const middleName = value.middleName ? part(value.middleName) : null
	const valid = (name: string) =>
		name.length <= 100 && /^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(name)
	if (
		!valid(firstName) ||
		!valid(lastName) ||
		(middleName !== null && !valid(middleName))
	)
		return null
	return { firstName, lastName, middleName }
}

export const parseEmployeeProfile = (
	value: unknown,
	request: EmployeeProfileRequest
): EmployeeProfileResponse | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'subject',
			'targetSubject',
			'profile'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== request.workspaceId ||
		value.subject !== request.subject ||
		value.targetSubject !== request.targetSubject
	)
		return null
	const profile = value.profile
	const binding = {
		workspaceId: request.workspaceId,
		subject: request.subject,
		targetSubject: request.targetSubject
	}
	if (profile === null)
		return { ...binding, schemaVersion: 1, profile: null }
	if (
		!isRecord(profile) ||
		!hasExactKeys(profile, [
			'id',
			'firstName',
			'lastName',
			'middleName',
			'version',
			'updatedAt'
		]) ||
		!isUuidV4(profile.id) ||
		typeof profile.firstName !== 'string' ||
		typeof profile.lastName !== 'string' ||
		!(
			profile.middleName === null || typeof profile.middleName === 'string'
		) ||
		!Number.isSafeInteger(profile.version) ||
		Number(profile.version) < 1 ||
		Number(profile.version) > 2147483647 ||
		!isIsoDate(profile.updatedAt)
	)
		return null
	const normalized = normalizeEmployeeName({
		firstName: profile.firstName,
		lastName: profile.lastName,
		middleName: profile.middleName
	})
	if (
		!normalized ||
		normalized.firstName !== profile.firstName ||
		normalized.lastName !== profile.lastName ||
		normalized.middleName !== profile.middleName
	)
		return null
	return {
		...binding,
		schemaVersion: 1,
		profile: {
			...normalized,
			id: profile.id,
			version: Number(profile.version),
			updatedAt: profile.updatedAt
		}
	}
}
