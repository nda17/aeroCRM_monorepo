export type PipelineStageState = 'OPEN' | 'WON' | 'LOST'

export interface PipelineTemplateStage {
	key: string
	name: string
	order: number
	state: PipelineStageState
}

export interface PipelineTemplate {
	key: string
	version: number
	name: string
	description: string
	industryTags: readonly string[]
	isBlank: boolean
	stages: readonly PipelineTemplateStage[]
}

export interface PipelineTemplateCatalog {
	schemaVersion: 1
	catalogRevision: number
	templates: readonly PipelineTemplate[]
}
