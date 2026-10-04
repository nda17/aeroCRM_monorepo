import type { SalesDealFilters } from '@/entities/sales'
import type { WorkdayFilters } from '@/entities/crm-workday/model/workday.types'

export type SavedViewScope = 'DEALS' | 'TASKS'
export interface SavedDealParameters extends Omit<
	SalesDealFilters,
	'overdueBefore'
> {
	search: string
	pipelineId: string
	status: string
	withoutNextAction: boolean
	layout: 'list' | 'board'
	sort: NonNullable<SalesDealFilters['sort']>
}
export type SavedTaskParameters = Omit<
	WorkdayFilters,
	'page' | 'pageSize' | 'columnId' | 'settingsVersion'
> & { layout: 'list' | 'board' }
export type SavedViewParameters = SavedDealParameters | SavedTaskParameters
export interface SavedViewBinding {
	workspaceId: string
	subject: string
	scope: SavedViewScope
}
export interface SavedView extends SavedViewBinding {
	id: string
	name: string
	parameters: SavedViewParameters
	version: number
	legacyKey: string | null
	archivedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface SavedViewsPage extends SavedViewBinding {
	schemaVersion: 1
	items: SavedView[]
}
export interface LegacySavedView {
	legacyKey: string
	name: string
	parameters: SavedDealParameters
}
export type SavedViewMutation =
	| { kind: 'create'; name: string; parameters: SavedViewParameters }
	| { kind: 'rename'; id: string; expectedVersion: number; name: string }
	| { kind: 'delete'; id: string; expectedVersion: number }
	| { kind: 'import'; views: LegacySavedView[] }
export interface SavedViewCommand extends SavedViewBinding {
	commandId: string
	mutation: SavedViewMutation
}
export type SavedViewCommandResult =
	| { schemaVersion: 1; view: SavedView }
	| (SavedViewsPage & { createdCount: number; skippedCount: number })
