import type { useWorkdaySession } from '@/entities/crm-workday'
import type { AssigneeDirectoryContext } from '@/entities/crm-team'
import { isIsoDate } from '@/shared/lib/contract'

export const deviceTimeZone = () =>
	Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const pad = (value: number) => String(value).padStart(2, '0')
export const taskLocalDate = (iso: string) => {
	if (!isIsoDate(iso)) return ''
	const date = new Date(iso)
	return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
/** Native datetime-local uses the explicitly labelled device timezone. Exact
 * component round-trip rejects date rollover and nonexistent DST-gap times. */
export const taskDueIso = (
	value: string,
	original?: { local: string; iso: string }
): string | null => {
	if (original && value === original.local && isIsoDate(original.iso))
		return original.iso
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
	const parts = value.match(/\d+/g)!.map(Number)
	if (parts[0] < 100 || parts[0] > 9999) return null
	const date = new Date(
		parts[0],
		parts[1] - 1,
		parts[2],
		parts[3],
		parts[4],
		0,
		0
	)
	if (
		!Number.isFinite(date.getTime()) ||
		!/^\d{4}-/.test(date.toISOString()) ||
		taskLocalDate(date.toISOString()) !== value
	)
		return null
	return date.toISOString()
}
export const workdayDirectoryContext = (
	context: ReturnType<typeof useWorkdaySession>
): AssigneeDirectoryContext => ({
	workspaceId: context.workspace.workspaceId,
	subject: context.session?.userId,
	accessToken: context.session?.accessToken,
	sessionRevision: context.sessionRevision,
	canRead: context.canRead,
	isCurrent: context.current,
	authority: context.permissions.data
})
export const workdayDateLabel = (iso: string, timeZone?: string) => {
	try {
		return new Intl.DateTimeFormat('ru-RU', {
			dateStyle: 'medium',
			timeStyle: 'short',
			...(timeZone ? { timeZone } : {})
		}).format(new Date(iso))
	} catch {
		return iso
	}
}
export const workdayStatusLabels = {
	OPEN: 'К выполнению',
	IN_PROGRESS: 'В работе',
	COMPLETED: 'Готово',
	CANCELLED: 'Отменена'
} as const
