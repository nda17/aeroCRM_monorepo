import type {
	PipelineStageState,
	PipelineTemplate,
	PipelineTemplateCatalog,
	PipelineTemplateStage
} from '@/entities/pipeline-template/model/pipeline-template.types'
import {
	hasExactKeys,
	isNonEmptyString,
	isRecord
} from '@/shared/lib/contract'

const KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const STAGE_STATES = ['OPEN', 'WON', 'LOST'] as const
const MAX_TEMPLATES = 100
const MAX_STAGES = 100
const MAX_TAGS = 50
const MAX_TEMPLATE_VERSION = 32767

const isPositiveInteger = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const isNonNegativeInteger = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isStageState = (value: unknown): value is PipelineStageState =>
	STAGE_STATES.includes(value as PipelineStageState)

const parseStage = (value: unknown): PipelineTemplateStage | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['key', 'name', 'order', 'state']) ||
		!isNonEmptyString(value.key, 64) ||
		!KEY_PATTERN.test(value.key) ||
		!isNonEmptyString(value.name, 200) ||
		!isNonNegativeInteger(value.order) ||
		!isStageState(value.state)
	) {
		return null
	}

	return {
		key: value.key,
		name: value.name,
		order: value.order,
		state: value.state
	}
}

const parseTemplate = (value: unknown): PipelineTemplate | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'key',
			'version',
			'name',
			'description',
			'industryTags',
			'isBlank',
			'stages'
		]) ||
		!isNonEmptyString(value.key, 64) ||
		!KEY_PATTERN.test(value.key) ||
		!isPositiveInteger(value.version) ||
		value.version > MAX_TEMPLATE_VERSION ||
		!isNonEmptyString(value.name, 200) ||
		!isNonEmptyString(value.description, 2000) ||
		typeof value.isBlank !== 'boolean' ||
		!Array.isArray(value.industryTags) ||
		value.industryTags.length > MAX_TAGS ||
		!value.industryTags.every(
			tag => isNonEmptyString(tag, 64) && KEY_PATTERN.test(tag)
		) ||
		new Set(value.industryTags).size !== value.industryTags.length ||
		!Array.isArray(value.stages) ||
		value.stages.length < 3 ||
		value.stages.length > MAX_STAGES
	) {
		return null
	}

	const stages: PipelineTemplateStage[] = []
	const stageKeys = new Set<string>()
	for (const item of value.stages) {
		const stage = parseStage(item)
		if (!stage || stageKeys.has(stage.key)) {
			return null
		}
		stageKeys.add(stage.key)
		stages.push(stage)
	}

	if (stages.some((stage, index) => stage.order !== index + 1)) {
		return null
	}

	const openCount = stages.filter(stage => stage.state === 'OPEN').length
	const wonCount = stages.filter(stage => stage.state === 'WON').length
	const lostCount = stages.filter(stage => stage.state === 'LOST').length
	const terminalStates = stages.slice(-2).map(stage => stage.state)
	if (
		openCount < 1 ||
		wonCount !== 1 ||
		lostCount !== 1 ||
		terminalStates[0] !== 'WON' ||
		terminalStates[1] !== 'LOST'
	) {
		return null
	}

	return {
		key: value.key,
		version: value.version,
		name: value.name,
		description: value.description,
		industryTags: [...value.industryTags],
		isBlank: value.isBlank,
		stages
	}
}

export const parsePipelineTemplateCatalog = (
	value: unknown
): PipelineTemplateCatalog | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'catalogRevision',
			'templates'
		]) ||
		value.schemaVersion !== 1 ||
		!isPositiveInteger(value.catalogRevision) ||
		!Array.isArray(value.templates) ||
		value.templates.length === 0 ||
		value.templates.length > MAX_TEMPLATES
	) {
		return null
	}

	const templates: PipelineTemplate[] = []
	const revisions = new Set<string>()
	for (const item of value.templates) {
		const template = parseTemplate(item)
		if (!template) {
			return null
		}

		const revision = `${template.key}:${template.version}`
		if (revisions.has(revision)) {
			return null
		}
		revisions.add(revision)
		templates.push(template)
	}

	return {
		schemaVersion: 1,
		catalogRevision: value.catalogRevision,
		templates
	}
}
