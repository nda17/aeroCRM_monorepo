import { describe, expect, it } from 'vitest'
import {
	parseActivityTextTemplates,
	parseSavedActivityTextTemplates,
	validSaveActivityTextTemplatesCommand,
	type SaveActivityTextTemplatesCommand
} from './activity-text-templates.contract'

const workspaceId = 'b531b13e-3624-4ec5-b66d-f24373b0b374'
const template = {
	id: 'd6249dca-c181-4ed8-8f31-83c263a7459e',
	title: ' Follow up ',
	body: ' Hello\tthere\r\nnext line\r ',
	archived: false
}
const command: SaveActivityTextTemplatesCommand = {
	schemaVersion: 1,
	workspaceId,
	commandId: 'b1c1d3d9-dc5a-4a50-98ba-c79b3895db62',
	expectedVersion: 0,
	templates: [template]
}
const snapshot = {
	schemaVersion: 1,
	workspaceId,
	version: 1,
	templates: [
		{
			...template,
			title: 'Follow up',
			body: 'Hello\tthere\nnext line'
		}
	]
}

describe('activity text template contract', () => {
	it('parses exact snapshots for the requested workspace', () => {
		expect(parseActivityTextTemplates(snapshot, workspaceId)).toEqual(
			snapshot
		)
		for (const invalid of [
			{ ...snapshot, extra: true },
			{ ...snapshot, schemaVersion: 2 },
			{ ...snapshot, workspaceId: command.commandId },
			{ ...snapshot, version: -1 },
			{ ...snapshot, version: 1.5 },
			{
				...snapshot,
				templates: [{ ...snapshot.templates[0], added: true }]
			}
		])
			expect(parseActivityTextTemplates(invalid, workspaceId)).toBeNull()
	})

	it('validates strict commands, bounds, and unique UUIDs case-insensitively', () => {
		expect(validSaveActivityTextTemplatesCommand(command)).toBe(true)
		for (const invalid of [
			{ ...command, unexpected: true },
			{ ...command, workspaceId: 'invalid' },
			{ ...command, expectedVersion: 2147483647 },
			{ ...command, expectedVersion: -1 },
			{ ...command, expectedVersion: 1.5 },
			{
				...command,
				templates: Array.from({ length: 101 }, (_, i) => ({
					...template,
					id: `d6249dca-c181-4ed8-8f31-83c263a7${String(i).padStart(4, '0')}`
				}))
			},
			{
				...command,
				templates: [
					template,
					{ ...template, id: template.id.toUpperCase() }
				]
			},
			{ ...command, templates: [{ ...template, title: `x\u0000` }] },
			{ ...command, templates: [{ ...template, body: ' \t\r\n ' }] },
			{ ...command, templates: [{ ...template, body: `x\u000b` }] },
			{ ...command, templates: [{ ...template, title: 'x'.repeat(201) }] },
			{ ...command, templates: [{ ...template, body: 'x'.repeat(4001) }] },
			{ ...command, templates: [{ ...template, archived: 0 }] }
		])
			expect(validSaveActivityTextTemplatesCommand(invalid)).toBe(false)
	})

	it('accepts the saved echo only when it has the next version and normalized command content', () => {
		expect(parseSavedActivityTextTemplates(snapshot, command)).toEqual(
			snapshot
		)
		for (const invalid of [
			{ ...snapshot, version: 0 },
			{ ...snapshot, version: 2 },
			{
				...snapshot,
				templates: [{ ...snapshot.templates[0], body: 'different' }]
			},
			{
				...snapshot,
				templates: [{ ...snapshot.templates[0], archived: true }]
			}
		])
			expect(parseSavedActivityTextTemplates(invalid, command)).toBeNull()
	})

	it('accepts inclusive field lengths and the permitted TAB, LF, and CR characters', () => {
		const boundaryCommand = {
			...command,
			templates: [
				{
					...template,
					title: ` ${'a'.repeat(198)} `,
					body: `\t${'b'.repeat(3997)}\r\n`
				}
			]
		}
		expect(validSaveActivityTextTemplatesCommand(boundaryCommand)).toBe(
			true
		)
	})

	it('matches service normalization for lone carriage returns in saved echoes', () => {
		const input = {
			...command,
			templates: [{ ...template, body: 'before\rafter' }]
		}
		const echo = {
			...snapshot,
			templates: [{ ...snapshot.templates[0], body: 'before\nafter' }]
		}
		expect(parseSavedActivityTextTemplates(echo, input)).toEqual(echo)
	})
})
