import {
	hasExactKeys,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export interface WorkspaceDisplaySummary {
	workspaceId: string
	membershipRole: 'OWNER' | 'MEMBER'
	displayName: string | null
}

export interface WorkspaceDisplaySummariesResponse {
	schemaVersion: 1
	scope: { subject: string }
	items: WorkspaceDisplaySummary[]
}

const isDisplayName = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length > 0 &&
	!/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>]/u.test(value) &&
	Array.from(value.normalize('NFC').trim()).length > 0 &&
	Array.from(value.normalize('NFC').trim()).length <= 40

export const parseWorkspaceDisplaySummaries = (
	value: unknown,
	expectedSubject: string
): WorkspaceDisplaySummariesResponse | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'scope', 'items']) ||
		value.schemaVersion !== 1 ||
		!isRecord(value.scope) ||
		!hasExactKeys(value.scope, ['subject']) ||
		!isNonEmptyString(value.scope.subject, 256) ||
		value.scope.subject !== expectedSubject ||
		!Array.isArray(value.items) ||
		value.items.length > 1000
	) {
		return null
	}

	const items: WorkspaceDisplaySummary[] = []
	const workspaceIds = new Set<string>()
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, [
				'workspaceId',
				'membershipRole',
				'displayName'
			]) ||
			!isUuidV4(item.workspaceId) ||
			workspaceIds.has(item.workspaceId) ||
			(item.membershipRole !== 'OWNER' &&
				item.membershipRole !== 'MEMBER') ||
			(item.displayName !== null && !isDisplayName(item.displayName))
		) {
			return null
		}
		workspaceIds.add(item.workspaceId)
		items.push({
			workspaceId: item.workspaceId,
			membershipRole: item.membershipRole,
			displayName: item.displayName
		})
	}

	return {
		schemaVersion: 1,
		scope: { subject: value.scope.subject },
		items
	}
}
