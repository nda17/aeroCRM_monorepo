import { isUuidV4 } from '@/shared/lib/contract'
import type { SalesDealFilters } from '@/entities/sales'

export interface DealView extends SalesDealFilters {
	search: string
	pipelineId: string
	status: string
	withoutNextAction: boolean
	layout: 'list' | 'board'
}
export interface SavedDealView {
	id: string
	name: string
	filters: DealView
}
export const defaultDealView: DealView = {
	search: '',
	pipelineId: '',
	status: '',
	withoutNextAction: false,
	layout: 'list',
	sort: 'created_desc'
}
const fields = [
	'search',
	'pipelineId',
	'status',
	'withoutNextAction',
	'layout',
	'stageId',
	'assignedToSubject',
	'overdue',
	'overdueBefore',
	'createdFrom',
	'createdTo',
	'sort'
] as const
const iso = (value: unknown) =>
	typeof value === 'string' &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value
export const parseDealView = (input: unknown): DealView => {
	const row =
		input && typeof input === 'object'
			? (input as Record<string, unknown>)
			: {}
	return {
		search: typeof row.search === 'string' ? row.search.slice(0, 200) : '',
		pipelineId: isUuidV4(row.pipelineId) ? row.pipelineId : '',
		status: ['OPEN', 'WON', 'LOST'].includes(String(row.status))
			? String(row.status)
			: '',
		withoutNextAction:
			row.withoutNextAction === true || row.withoutNextAction === 'true',
		layout: row.layout === 'board' ? 'board' : 'list',
		sort: ([
			'created_desc',
			'updated_desc',
			'amount_desc',
			'next_action_asc'
		].includes(String(row.sort))
			? row.sort
			: 'created_desc') as DealView['sort'],
		...(isUuidV4(row.stageId) ? { stageId: row.stageId } : {}),
		...(typeof row.assignedToSubject === 'string' &&
		/^[^\s\x00-\x1f\x7f]{1,256}$/.test(row.assignedToSubject)
			? { assignedToSubject: row.assignedToSubject }
			: {}),
		...(row.overdue === true || row.overdue === 'true'
			? { overdue: true }
			: {}),
		...(iso(row.overdueBefore)
			? { overdueBefore: row.overdueBefore as string }
			: {}),
		...(iso(row.createdFrom)
			? { createdFrom: row.createdFrom as string }
			: {}),
		...(iso(row.createdTo) ? { createdTo: row.createdTo as string } : {})
	}
}
export const dealViewFromSearch = (
	search: string,
	fallback: DealView = defaultDealView
) => {
	const query = new URLSearchParams(search)
	return fields.some(key => query.has(key))
		? parseDealView(Object.fromEntries(query))
		: fallback
}
export const sameDealView = (left: DealView, right: DealView) =>
	fields.every(key => left[key] === right[key])
export const writeDealViewLocation = (
	view: DealView,
	selected: string | null
) => {
	const url = new URL(window.location.href)
	for (const key of fields) {
		url.searchParams.delete(key)
		const value = view[key]
		if (
			value !== undefined &&
			value !== '' &&
			value !== false &&
			value !== defaultDealView[key]
		)
			url.searchParams.set(key, String(value))
	}
	// An explicit default view must override a remembered board on the next visit.
	url.searchParams.set('layout', view.layout)
	url.searchParams.delete('dealId')
	if (selected) url.searchParams.set('dealId', selected)
	// Next copies its router state for external writes. Passing history.state
	// marks this as an internal write and skips the useSearchParams update.
	window.history.replaceState(
		null,
		'',
		`${url.pathname}${url.search}${url.hash}`
	)
}
export const readStoredDealViews = (
	key: string
): { last: DealView; saved: SavedDealView[] } => {
	try {
		const data = JSON.parse(window.localStorage.getItem(key) || '{}')
		return {
			last: parseDealView(data?.last),
			saved: Array.isArray(data?.saved)
				? data.saved
						.slice(0, 10)
						.filter(
							(row: SavedDealView) =>
								row &&
								typeof row.id === 'string' &&
								typeof row.name === 'string' &&
								row.name.trim() &&
								row.name.length <= 60
						)
						.map((row: SavedDealView) => ({
							id: row.id,
							name: row.name,
							filters: parseDealView(row.filters)
						}))
				: []
		}
	} catch {
		return { last: defaultDealView, saved: [] }
	}
}
export const requestDealFilters = (view: DealView): SalesDealFilters => ({
	...(view.stageId ? { stageId: view.stageId } : {}),
	...(view.assignedToSubject
		? { assignedToSubject: view.assignedToSubject }
		: {}),
	...(view.overdue ? { overdue: true } : {}),
	...(view.overdueBefore ? { overdueBefore: view.overdueBefore } : {}),
	...(view.createdFrom ? { createdFrom: view.createdFrom } : {}),
	...(view.createdTo ? { createdTo: view.createdTo } : {}),
	...(view.sort !== 'created_desc' ? { sort: view.sort } : {})
})
