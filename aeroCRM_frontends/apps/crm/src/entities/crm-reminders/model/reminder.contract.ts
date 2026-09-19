import {
	hasExactKeys,
	isIsoDate as isIsoInstant,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'
import { isIanaTimeZone } from '@/shared/lib/time-zones'

export interface ReminderBinding {
	subject: string
	membershipId: string | null
}
export type ReminderScope = 'WORKSPACE' | 'PERSONAL'
export interface ReminderRule {
	schemaVersion: 1
	id: string
	scope: ReminderScope
	ownerBinding: ReminderBinding
	title: string
	enabled: boolean
	channels: ('EMAIL' | 'TELEGRAM')[]
	trigger: {
		kind: 'BEFORE_DUE' | 'AT_DUE' | 'AFTER_DUE' | 'ASSIGNED'
		offsetMinutes: number
	}
	repeats: { intervalMinutes: number; count: number } | null
	timeZone: string
	quietHours: { start: string; end: string } | null
	recipients:
		| { kind: 'SELF' | 'ASSIGNEE' | 'TEAM_LEADS' | 'WORKSPACE' }
		| { kind: 'SELECTED'; bindings: ReminderBinding[] }
}
export interface ReminderItem {
	workspaceId: string
	rule: ReminderRule
	version: number
	archivedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface ReminderPage {
	schemaVersion: 1
	workspaceId: string
	page: number
	pageSize: number
	total: number
	items: ReminderItem[]
	limits: { WORKSPACE: number; PERSONAL: number }
	deliveryReady: boolean
}
export interface ReminderPageRequest {
	workspaceId: string
	actor: ReminderBinding
	scope: ReminderScope
	archived: boolean
	page: number
	pageSize: number
}
export interface ReminderResult {
	schemaVersion: 1
	item: ReminderItem
	deliveryReady: boolean
}
export interface ReminderCommand {
	commandId: string
	workspaceId: string
	actor: ReminderBinding
	action: 'create' | 'edit' | 'archive'
	rule: ReminderRule
	expectedVersion?: number
}
const integer = (value: unknown, min: number, max: number) =>
	typeof value === 'number' &&
	Number.isSafeInteger(value) &&
	!Object.is(value, -0) &&
	value >= min &&
	value <= max
const exact = (
	value: unknown,
	keys: string[]
): value is Record<string, unknown> =>
	isRecord(value) && hasExactKeys(value, keys)
export const validReminderBinding = (
	value: unknown
): value is ReminderBinding =>
	exact(value, ['subject', 'membershipId']) &&
	typeof value.subject === 'string' &&
	/^[^\s\x00-\x1f\x7f]{1,256}$/.test(value.subject) &&
	(value.membershipId === null || isUuidV4(value.membershipId))
export const sameReminderBinding = (
	a: ReminderBinding,
	b: ReminderBinding
) => a.subject === b.subject && a.membershipId === b.membershipId
const hours = (value: unknown) =>
	exact(value, ['start', 'end']) &&
	typeof value.start === 'string' &&
	typeof value.end === 'string' &&
	/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start) &&
	/^([01]\d|2[0-3]):[0-5]\d$/.test(value.end) &&
	value.start !== value.end

export const parseReminderRule = (value: unknown): ReminderRule | null => {
	if (
		!exact(value, [
			'schemaVersion',
			'id',
			'scope',
			'ownerBinding',
			'title',
			'enabled',
			'channels',
			'trigger',
			'repeats',
			'timeZone',
			'quietHours',
			'recipients'
		]) ||
		value.schemaVersion !== 1 ||
		!isUuidV4(value.id) ||
		!['WORKSPACE', 'PERSONAL'].includes(String(value.scope)) ||
		!validReminderBinding(value.ownerBinding) ||
		typeof value.title !== 'string' ||
		!/\S/.test(value.title) ||
		value.title.length > 120 ||
		typeof value.enabled !== 'boolean' ||
		!Array.isArray(value.channels) ||
		value.channels.length > 2 ||
		!value.channels.every(
			channel => channel === 'EMAIL' || channel === 'TELEGRAM'
		) ||
		new Set(value.channels).size !== value.channels.length ||
		(value.enabled && !value.channels.length) ||
		!isIanaTimeZone(value.timeZone) ||
		value.timeZone.trim() !== value.timeZone ||
		(value.quietHours !== null && !hours(value.quietHours))
	)
		return null
	const trigger = value.trigger
	if (
		!exact(trigger, ['kind', 'offsetMinutes']) ||
		!['BEFORE_DUE', 'AT_DUE', 'AFTER_DUE', 'ASSIGNED'].includes(
			String(trigger.kind)
		) ||
		!integer(
			trigger.offsetMinutes,
			trigger.kind === 'AT_DUE' || trigger.kind === 'ASSIGNED' ? 0 : 1,
			trigger.kind === 'AT_DUE' || trigger.kind === 'ASSIGNED' ? 0 : 43200
		)
	)
		return null
	if (
		value.repeats !== null &&
		(trigger.kind === 'ASSIGNED' ||
			!exact(value.repeats, ['intervalMinutes', 'count']) ||
			!integer(value.repeats.intervalMinutes, 15, 43200) ||
			!integer(value.repeats.count, 2, 1000))
	)
		return null
	const recipients = value.recipients
	if (!isRecord(recipients)) return null
	if (value.scope === 'PERSONAL') {
		if (!hasExactKeys(recipients, ['kind']) || recipients.kind !== 'SELF')
			return null
	} else if (recipients.kind === 'SELECTED') {
		if (
			!hasExactKeys(recipients, ['kind', 'bindings']) ||
			!Array.isArray(recipients.bindings) ||
			!recipients.bindings.length ||
			recipients.bindings.length > 100 ||
			!recipients.bindings.every(validReminderBinding) ||
			new Set(
				recipients.bindings.map(binding =>
					JSON.stringify([
						binding.subject,
						binding.membershipId?.toLowerCase() ?? null
					])
				)
			).size !== recipients.bindings.length
		)
			return null
	} else if (
		!hasExactKeys(recipients, ['kind']) ||
		!['ASSIGNEE', 'TEAM_LEADS', 'WORKSPACE'].includes(
			String(recipients.kind)
		)
	)
		return null
	return value as unknown as ReminderRule
}
export const reminderRuleKey = (rule: ReminderRule) =>
	JSON.stringify(
		{
			...rule,
			channels: [...rule.channels].sort(),
			recipients:
				rule.recipients.kind === 'SELECTED'
					? {
							kind: 'SELECTED',
							bindings: [...rule.recipients.bindings].sort((a, b) =>
								JSON.stringify(a) < JSON.stringify(b) ? -1 : 1
							)
						}
					: rule.recipients
		},
		(_key, entry) =>
			entry && typeof entry === 'object' && !Array.isArray(entry)
				? Object.fromEntries(
						Object.entries(entry).sort(([a], [b]) =>
							a < b ? -1 : a > b ? 1 : 0
						)
					)
				: entry
	)
export const parseReminderItem = (
	value: unknown,
	workspaceId: string
): ReminderItem | null => {
	if (
		!exact(value, [
			'workspaceId',
			'rule',
			'version',
			'archivedAt',
			'createdAt',
			'updatedAt'
		]) ||
		value.workspaceId !== workspaceId ||
		!isUuidV4(workspaceId) ||
		!parseReminderRule(value.rule) ||
		!integer(value.version, 1, 2147483647) ||
		!(value.archivedAt === null || isIsoInstant(value.archivedAt)) ||
		!isIsoInstant(value.createdAt) ||
		!isIsoInstant(value.updatedAt)
	)
		return null
	return value as unknown as ReminderItem
}
export const validReminderPageRequest = (request: ReminderPageRequest) =>
	isUuidV4(request.workspaceId) &&
	validReminderBinding(request.actor) &&
	['WORKSPACE', 'PERSONAL'].includes(request.scope) &&
	typeof request.archived === 'boolean' &&
	integer(request.page, 1, 1000000) &&
	integer(request.pageSize, 1, 100)
export const parseReminderPage = (
	value: unknown,
	request: ReminderPageRequest
): ReminderPage | null => {
	if (
		!validReminderPageRequest(request) ||
		!exact(value, [
			'schemaVersion',
			'workspaceId',
			'page',
			'pageSize',
			'total',
			'items',
			'limits',
			'deliveryReady'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== request.workspaceId ||
		value.page !== request.page ||
		value.pageSize !== request.pageSize ||
		!integer(value.total, 0, Number.MAX_SAFE_INTEGER) ||
		typeof value.deliveryReady !== 'boolean' ||
		!exact(value.limits, ['WORKSPACE', 'PERSONAL']) ||
		value.limits.WORKSPACE !== 20 ||
		value.limits.PERSONAL !== 10 ||
		!Array.isArray(value.items) ||
		value.items.length !==
			Math.min(
				request.pageSize,
				Math.max(
					0,
					Number(value.total) - (request.page - 1) * request.pageSize
				)
			)
	)
		return null
	const items = value.items.map(item =>
		parseReminderItem(item, request.workspaceId)
	)
	if (
		items.some(
			item =>
				!item ||
				item.rule.scope !== request.scope ||
				(item.archivedAt !== null) !== request.archived ||
				(request.scope === 'PERSONAL' &&
					!sameReminderBinding(item.rule.ownerBinding, request.actor))
		) ||
		new Set(items.map(item => item!.rule.id)).size !== items.length
	)
		return null
	return value as unknown as ReminderPage
}
export const parseReminderResult = (
	value: unknown,
	command: ReminderCommand
): ReminderResult | null => {
	if (
		!exact(value, ['schemaVersion', 'item', 'deliveryReady']) ||
		value.schemaVersion !== 1 ||
		typeof value.deliveryReady !== 'boolean'
	)
		return null
	const item = parseReminderItem(value.item, command.workspaceId)
	if (
		!item ||
		reminderRuleKey(item.rule) !== reminderRuleKey(command.rule) ||
		item.version !==
			(command.action === 'create'
				? 1
				: (command.expectedVersion ?? 0) + 1) ||
		(item.archivedAt !== null) !== (command.action === 'archive')
	)
		return null
	return value as unknown as ReminderResult
}
