export const PLANNER_STATUSES = [
	'OPEN',
	'IN_PROGRESS',
	'COMPLETED',
	'CANCELLED'
] as const
export type PlannerStatus = (typeof PLANNER_STATUSES)[number]
export type PlannerColumnId = PlannerStatus | string

export interface PlannerTemplate {
	id: string
	title: string
	archived: boolean
}

export interface PlannerColumn {
	id: PlannerColumnId
	name: string
	status: PlannerStatus
	isDefault: boolean
	archived: boolean
}

export interface PlannerSettings {
	schemaVersion: 1
	workspaceId: string
	version: number
	templates: PlannerTemplate[]
	columns: PlannerColumn[]
}

export interface SavePlannerSettingsCommand {
	schemaVersion: 1
	workspaceId: string
	commandId: string
	expectedVersion: number
	templates: PlannerTemplate[]
	columns: PlannerColumn[]
}
