import { describe, expect, it } from 'vitest'
import { parsePipelineTemplateCatalog } from './pipeline-template.parser'

describe('parsePipelineTemplateCatalog', () => {
	it('accepts the versioned catalog contract', () => {
		const value = {
			schemaVersion: 1,
			catalogRevision: 1,
			templates: [
				{
					key: 'sales',
					version: 2,
					name: 'Продажи',
					description: 'Базовая воронка',
					industryTags: ['general'],
					isBlank: false,
					stages: [
						{ key: 'new', name: 'Новая', order: 1, state: 'OPEN' },
						{ key: 'won', name: 'Успех', order: 2, state: 'WON' },
						{ key: 'lost', name: 'Отказ', order: 3, state: 'LOST' }
					]
				}
			]
		}
		expect(parsePipelineTemplateCatalog(value)).toEqual(value)
	})

	it('rejects unknown fields and versions outside the database contract', () => {
		expect(
			parsePipelineTemplateCatalog({
				schemaVersion: 1,
				catalogVersion: 1,
				templates: []
			})
		).toBeNull()
		expect(
			parsePipelineTemplateCatalog({
				schemaVersion: 1,
				catalogRevision: 1,
				templates: [{ key: 'x', version: 0 }]
			})
		).toBeNull()
		expect(
			parsePipelineTemplateCatalog({
				schemaVersion: 1,
				catalogRevision: 1,
				templates: [
					{
						key: 'sales',
						version: 32768,
						name: 'Продажи',
						description: 'Базовая воронка',
						industryTags: ['general'],
						isBlank: false,
						stages: [
							{
								key: 'new',
								name: 'Новая',
								order: 1,
								state: 'OPEN'
							},
							{
								key: 'won',
								name: 'Успех',
								order: 2,
								state: 'WON'
							},
							{
								key: 'lost',
								name: 'Отказ',
								order: 3,
								state: 'LOST'
							}
						]
					}
				]
			})
		).toBeNull()
	})

	it.each([
		{
			stages: [
				{ key: 'new', name: 'Новая', order: 1, state: 'OPEN' },
				{ key: 'won', name: 'Успех', order: 2, state: 'WON' }
			]
		},
		{
			stages: [
				{ key: 'new', name: 'Новая', order: 0, state: 'OPEN' },
				{ key: 'won', name: 'Успех', order: 1, state: 'WON' },
				{ key: 'lost', name: 'Отказ', order: 2, state: 'LOST' }
			]
		},
		{
			stages: [
				{ key: 'new', name: 'Новая', order: 1, state: 'OPEN' },
				{ key: 'won', name: 'Успех', order: 2, state: 'WON' },
				{ key: 'again', name: 'Снова в работе', order: 3, state: 'OPEN' }
			]
		},
		{
			stages: [
				{ key: 'new', name: 'Новая', order: 1, state: 'OPEN' },
				{ key: 'lost', name: 'Отказ', order: 2, state: 'LOST' },
				{ key: 'won', name: 'Успех', order: 3, state: 'WON' }
			]
		}
	])('rejects invalid stage semantics: $stages', ({ stages }) => {
		expect(
			parsePipelineTemplateCatalog({
				schemaVersion: 1,
				catalogRevision: 1,
				templates: [
					{
						key: 'sales',
						version: 1,
						name: 'Продажи',
						description: 'Базовая воронка',
						industryTags: ['general'],
						isBlank: false,
						stages
					}
				]
			})
		).toBeNull()
	})
})
