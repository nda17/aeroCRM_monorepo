import { describe, expect, it } from 'vitest'
import {
	parsePlannerSettings,
	parseSavedPlannerSettings,
	validSavePlannerSettingsCommand
} from './planner.contract'
import type {
	PlannerColumn,
	SavePlannerSettingsCommand
} from './planner.types'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const commandId = '22222222-2222-4222-8222-222222222222'
const customId = '33333333-3333-4333-8333-333333333333'
const defaults: PlannerColumn[] = [
	{
		id: 'OPEN',
		name: 'К выполнению',
		status: 'OPEN',
		isDefault: true,
		archived: false
	},
	{
		id: 'IN_PROGRESS',
		name: 'В работе',
		status: 'IN_PROGRESS',
		isDefault: true,
		archived: false
	},
	{
		id: 'COMPLETED',
		name: 'Готово',
		status: 'COMPLETED',
		isDefault: true,
		archived: false
	},
	{
		id: 'CANCELLED',
		name: 'Отменена',
		status: 'CANCELLED',
		isDefault: true,
		archived: false
	}
]
const command: SavePlannerSettingsCommand = {
	schemaVersion: 1,
	workspaceId,
	commandId,
	expectedVersion: 0,
	templates: [
		{
			id: '44444444-4444-4444-8444-444444444444',
			title: 'Позвонить клиенту',
			archived: false
		}
	],
	columns: [
		...defaults,
		{
			id: customId,
			name: 'Проверка',
			status: 'IN_PROGRESS',
			isDefault: false,
			archived: false
		}
	]
}
const envelope = (version = 0) => ({
	schemaVersion: 1,
	workspaceId,
	version,
	templates: command.templates,
	columns: command.columns
})

describe('Planner settings contracts', () => {
	it('accepts workspace-bound settings and preserves UI array order', () => {
		const settings = parsePlannerSettings(envelope(), workspaceId)
		expect(settings?.columns.map(column => column.id)).toEqual(
			command.columns.map(column => column.id)
		)
		expect(settings?.templates).toEqual(command.templates)
	})

	it('accepts a valid optimistic command and binds save result to the next version', () => {
		expect(validSavePlannerSettingsCommand(command)).toBe(true)
		expect(parseSavedPlannerSettings(envelope(1), command)?.version).toBe(
			1
		)
		expect(parseSavedPlannerSettings(envelope(2), command)).toBeNull()
		const reorderedKeys = envelope(1)
		reorderedKeys.templates = reorderedKeys.templates.map(item =>
			Object.fromEntries(Object.entries(item).reverse())
		) as typeof command.templates
		expect(
			parseSavedPlannerSettings(reorderedKeys, command)
		).not.toBeNull()
		expect(
			parseSavedPlannerSettings(
				{ ...envelope(1), columns: [...command.columns].reverse() },
				command
			)
		).toBeNull()
		expect(
			parseSavedPlannerSettings(
				{
					...envelope(1),
					templates: [{ ...command.templates[0], title: 'Другой шаблон' }]
				},
				command
			)
		).toBeNull()
	})

	it.each([
		{ workspaceId: 'wrong-workspace' },
		{ version: -1 },
		{ extra: true },
		{ columns: defaults.slice(0, 3) },
		{ columns: [...defaults, ...defaults] },
		{
			templates: Array.from({ length: 101 }, (_, index) => ({
				id: `${index}`,
				title: 'x',
				archived: false
			}))
		},
		{
			columns: defaults.map(column =>
				column.id === 'OPEN' ? { ...column, archived: true } : column
			)
		},
		{
			columns: defaults.map(column =>
				column.id === 'OPEN' ? { ...column, status: 'COMPLETED' } : column
			)
		},
		{ templates: [{ ...command.templates[0], title: '   ' }] },
		{
			columns: [
				...defaults,
				{
					id: customId,
					name: 'Кастомная',
					status: 'OPEN',
					isDefault: false,
					archived: false
				},
				{
					id: customId,
					name: 'Дубль',
					status: 'OPEN',
					isDefault: false,
					archived: false
				}
			]
		}
	])('rejects malformed settings %#', override => {
		expect(
			parsePlannerSettings({ ...envelope(), ...override }, workspaceId)
		).toBeNull()
	})
})
