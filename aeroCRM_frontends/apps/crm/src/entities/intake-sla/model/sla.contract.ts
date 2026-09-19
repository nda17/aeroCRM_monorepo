import {
	hasExactKeys,
	isIsoDate,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import { isIanaTimeZone } from '@/shared/lib/time-zones'

export interface SlaBinding {
	subject: string
	membershipId: string | null
}
export interface SlaConfig {
	enabled: boolean
	workingMinutes: number
	timeZone: string
	weekdays: number[]
	workStart: string
	workEnd: string
	responsibleBinding: SlaBinding | null
	notifyManagers: boolean
	channels: ('EMAIL' | 'TELEGRAM')[]
}
export interface SlaRuleResponse {
	schemaVersion: 1
	workspaceId: string
	rule: { version: number; config: SlaConfig; effectiveAt: string } | null
	deliveryEnabled: boolean
}
export interface SlaCommand {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	expectedVersion: number
	config: SlaConfig
}
export interface InboxSlaItem {
	entryId: string
	state: 'PENDING' | 'BREACHED' | 'STOPPED' | 'NOT_TRACKED'
	dueAt: string | null
}
export interface InboxSlaResponse {
	schemaVersion: 1
	workspaceId: string
	items: InboxSlaItem[]
	deliveryEnabled: boolean
}
const timeMinutes = (value: unknown): number | null => {
	if (
		typeof value !== 'string' ||
		!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
	)
		return null
	const [hours, minutes] = value.split(':').map(Number)
	return hours * 60 + minutes
}
export const parseSlaConfig = (value: unknown): SlaConfig | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'enabled',
			'workingMinutes',
			'timeZone',
			'weekdays',
			'workStart',
			'workEnd',
			'responsibleBinding',
			'notifyManagers',
			'channels'
		])
	)
		return null
	const start = timeMinutes(value.workStart)
	const end = timeMinutes(value.workEnd)
	const binding = value.responsibleBinding
	if (
		typeof value.enabled !== 'boolean' ||
		typeof value.notifyManagers !== 'boolean' ||
		(value.enabled && binding === null && !value.notifyManagers) ||
		!Number.isSafeInteger(value.workingMinutes) ||
		Number(value.workingMinutes) < 1 ||
		Number(value.workingMinutes) > 1440 ||
		!isIanaTimeZone(value.timeZone) ||
		start === null ||
		end === null ||
		end - start < 30 ||
		!Array.isArray(value.weekdays) ||
		value.weekdays.length < 1 ||
		value.weekdays.length > 7 ||
		!value.weekdays.every(
			day => Number.isInteger(day) && day >= 1 && day <= 7
		) ||
		new Set(value.weekdays).size !== value.weekdays.length ||
		!Array.isArray(value.channels) ||
		value.channels.length < 1 ||
		value.channels.length > 2 ||
		!value.channels.every(
			channel => channel === 'EMAIL' || channel === 'TELEGRAM'
		) ||
		new Set(value.channels).size !== value.channels.length ||
		(binding !== null &&
			(!isRecord(binding) ||
				!hasExactKeys(binding, ['subject', 'membershipId']) ||
				typeof binding.subject !== 'string' ||
				!/^[^\s\x00-\x1f\x7f]{1,256}$/.test(binding.subject) ||
				(binding.membershipId !== null &&
					!isUuidV4(binding.membershipId))))
	)
		return null
	return value as unknown as SlaConfig
}
export const validSlaCommand = (value: SlaCommand) =>
	value.schemaVersion === 1 &&
	isUuidV4(value.workspaceId) &&
	isUuidV4(value.commandId) &&
	Number.isSafeInteger(value.expectedVersion) &&
	value.expectedVersion >= 0 &&
	value.expectedVersion < 2147483646 &&
	!!parseSlaConfig(value.config)

export const parseSlaRule = (
	value: unknown,
	workspaceId: string
): SlaRuleResponse | null => {
	if (
		!isUuidV4(workspaceId) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'rule',
			'deliveryEnabled'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		typeof value.deliveryEnabled !== 'boolean'
	)
		return null
	const rule = value.rule
	if (
		rule !== null &&
		(!isRecord(rule) ||
			!hasExactKeys(rule, ['version', 'config', 'effectiveAt']) ||
			!Number.isSafeInteger(rule.version) ||
			Number(rule.version) < 1 ||
			Number(rule.version) > 2147483647 ||
			!parseSlaConfig(rule.config) ||
			!isIsoDate(rule.effectiveAt))
	)
		return null
	return value as unknown as SlaRuleResponse
}
export const validInboxSlaIds = (ids: string[]) =>
	ids.length > 0 &&
	ids.length <= 100 &&
	ids.every(isUuidV4) &&
	new Set(ids).size === ids.length
export const parseInboxSla = (
	value: unknown,
	workspaceId: string,
	entryIds: string[]
): InboxSlaResponse | null => {
	if (
		!isUuidV4(workspaceId) ||
		!validInboxSlaIds(entryIds) ||
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'items',
			'deliveryEnabled'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		typeof value.deliveryEnabled !== 'boolean' ||
		!Array.isArray(value.items) ||
		value.items.length > entryIds.length ||
		!value.items.every(
			item =>
				isRecord(item) &&
				hasExactKeys(item, ['entryId', 'state', 'dueAt']) &&
				typeof item.entryId === 'string' &&
				entryIds.includes(item.entryId) &&
				['PENDING', 'BREACHED', 'STOPPED', 'NOT_TRACKED'].includes(
					String(item.state)
				) &&
				(item.dueAt === null || isIsoDate(item.dueAt)) &&
				(!['PENDING', 'BREACHED'].includes(String(item.state)) ||
					item.dueAt !== null)
		) ||
		new Set(value.items.map(item => item.entryId)).size !==
			value.items.length
	)
		return null
	return value as unknown as InboxSlaResponse
}
