import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export const COMPANY_NAME_LIMIT = 40
export interface BrandingRequest {
	workspaceId: string
	subject: string
}
export interface WorkspaceBranding {
	displayName: string | null
	version: number
	updatedAt: string | null
}
export interface BrandingResponse extends BrandingRequest {
	schemaVersion: 1
	branding: WorkspaceBranding
	commandId?: string
}
export interface BrandingCommand extends BrandingRequest {
	commandId: string
	expectedVersion: number
	displayName: string | null
}

// undefined is invalid; null is an intentional removal of the caption.
export const normalizeCompanyName = (
	value: unknown
): string | null | undefined => {
	if (value === null) return null
	if (
		typeof value !== 'string' ||
		value.length > 4096 ||
		/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029<>]/u.test(value)
	)
		return undefined
	const normalized = value.normalize('NFC').trim()
	if ([...normalized].length > COMPANY_NAME_LIMIT) return undefined
	return normalized || null
}

export const parseWorkspaceBranding = (
	value: unknown,
	request: BrandingRequest & { commandId?: string }
): BrandingResponse | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'subject',
			'branding',
			...(request.commandId ? ['commandId'] : [])
		]) ||
		value.schemaVersion !== 1 ||
		!isUuidV4(value.workspaceId) ||
		value.workspaceId !== request.workspaceId ||
		!isNonEmptyString(value.subject, 256) ||
		value.subject !== request.subject ||
		(request.commandId &&
			(!isUuidV4(value.commandId) ||
				value.commandId !== request.commandId))
	)
		return null
	const branding = value.branding
	if (
		!isRecord(branding) ||
		!hasExactKeys(branding, ['displayName', 'version', 'updatedAt']) ||
		!(
			branding.displayName === null ||
			typeof branding.displayName === 'string'
		) ||
		normalizeCompanyName(branding.displayName) !== branding.displayName ||
		!Number.isSafeInteger(branding.version) ||
		Number(branding.version) < 0 ||
		Number(branding.version) > 2147483647 ||
		(branding.version === 0
			? branding.displayName !== null || branding.updatedAt !== null
			: !isIsoDate(branding.updatedAt))
	)
		return null
	return value as unknown as BrandingResponse
}
