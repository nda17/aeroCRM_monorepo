export type CrmPipelineStageState = 'OPEN' | 'WON' | 'LOST'

export type CrmPipelineTemplateStage = {
	key: string
	name: string
	order: number
	state: CrmPipelineStageState
}

export type CrmPipelineTemplate = {
	key: string
	version: number
	name: string
	description: string
	industryTags: string[]
	isBlank: boolean
	stages: CrmPipelineTemplateStage[]
}

export type CrmPipelineTemplateCatalog = {
	schemaVersion: 1
	catalogRevision: number
	templates: CrmPipelineTemplate[]
}

const STAGE_STATES = new Set<CrmPipelineStageState>([
	'OPEN',
	'WON',
	'LOST'
])
const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const MAX_TEMPLATE_VERSION = 32767
const MAX_TEMPLATES = 100
const MAX_KEY_LENGTH = 64
const MAX_TEMPLATE_NAME_LENGTH = 200
const MAX_TEMPLATE_DESCRIPTION_LENGTH = 2000
const MAX_INDUSTRY_TAGS = 50
const MAX_STAGES = 100
const MAX_STAGE_NAME_LENGTH = 200

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (
	value: Record<string, unknown>,
	expectedKeys: readonly string[]
) => {
	const keys = Object.keys(value)
	return (
		keys.length === expectedKeys.length &&
		expectedKeys.every(key =>
			Object.prototype.hasOwnProperty.call(value, key)
		)
	)
}

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0

const isKey = (value: unknown): value is string =>
	isNonEmptyString(value) &&
	value.length <= MAX_KEY_LENGTH &&
	TEMPLATE_KEY_PATTERN.test(value)

const parseStage = (value: unknown): CrmPipelineTemplateStage => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['key', 'name', 'order', 'state'])
	)
		throw new Error('Invalid WinCRM template stage')

	const { key, name, order, state } = value
	if (
		!isKey(key) ||
		!isNonEmptyString(name) ||
		name.length > MAX_STAGE_NAME_LENGTH ||
		!Number.isSafeInteger(order) ||
		(order as number) < 1 ||
		!STAGE_STATES.has(state as CrmPipelineStageState)
	) {
		throw new Error('Invalid WinCRM template stage')
	}

	return {
		key,
		name,
		order: order as number,
		state: state as CrmPipelineStageState
	}
}

const validateStageSequence = (stages: CrmPipelineTemplateStage[]) => {
	const stageKeys = new Set<string>()
	const stateCounts = { OPEN: 0, WON: 0, LOST: 0 }
	let terminalStageStarted = false

	stages.forEach((stage, index) => {
		if (stageKeys.has(stage.key) || stage.order !== index + 1) {
			throw new Error('Invalid WinCRM template stages')
		}
		stageKeys.add(stage.key)
		stateCounts[stage.state] += 1
		if (stage.state !== 'OPEN') terminalStageStarted = true
		if (terminalStageStarted && stage.state === 'OPEN') {
			throw new Error('Invalid WinCRM template stages')
		}
	})

	if (
		stateCounts.OPEN < 1 ||
		stateCounts.WON !== 1 ||
		stateCounts.LOST !== 1 ||
		stages.at(-2)?.state !== 'WON' ||
		stages.at(-1)?.state !== 'LOST'
	) {
		throw new Error('Invalid WinCRM template stages')
	}
}

const parseTemplate = (value: unknown): CrmPipelineTemplate => {
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
		])
	)
		throw new Error('Invalid WinCRM pipeline template')

	const {
		key,
		version,
		name,
		description,
		industryTags,
		isBlank,
		stages
	} = value

	if (
		!isKey(key) ||
		!Number.isSafeInteger(version) ||
		(version as number) < 1 ||
		(version as number) > MAX_TEMPLATE_VERSION ||
		!isNonEmptyString(name) ||
		name.length > MAX_TEMPLATE_NAME_LENGTH ||
		!isNonEmptyString(description) ||
		description.length > MAX_TEMPLATE_DESCRIPTION_LENGTH ||
		!Array.isArray(industryTags) ||
		industryTags.length > MAX_INDUSTRY_TAGS ||
		!industryTags.every(isKey) ||
		new Set(industryTags).size !== industryTags.length ||
		typeof isBlank !== 'boolean' ||
		!Array.isArray(stages) ||
		stages.length < 3 ||
		stages.length > MAX_STAGES
	) {
		throw new Error('Invalid WinCRM pipeline template')
	}

	const parsedStages = stages.map(parseStage)
	validateStageSequence(parsedStages)

	return {
		key,
		version: version as number,
		name,
		description,
		industryTags,
		isBlank,
		stages: parsedStages
	}
}

export const parseCrmPipelineTemplateCatalog = (
	value: unknown
): CrmPipelineTemplateCatalog => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', 'catalogRevision', 'templates'])
	)
		throw new Error('Invalid WinCRM template catalog')

	const { schemaVersion, catalogRevision, templates } = value
	if (
		schemaVersion !== 1 ||
		!Number.isSafeInteger(catalogRevision) ||
		(catalogRevision as number) < 1 ||
		!Array.isArray(templates) ||
		templates.length === 0 ||
		templates.length > MAX_TEMPLATES
	) {
		throw new Error('Unsupported WinCRM template catalog')
	}

	const parsedTemplates = templates.map(parseTemplate)
	const templateVersions = new Set(
		parsedTemplates.map(template => `${template.key}@${template.version}`)
	)
	if (templateVersions.size !== parsedTemplates.length) {
		throw new Error('Duplicate WinCRM template version')
	}

	return {
		schemaVersion,
		catalogRevision: catalogRevision as number,
		templates: parsedTemplates
	}
}
