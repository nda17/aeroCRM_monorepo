import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Color = readonly [number, number, number]
type Theme = 'light' | 'dark'

const globalStyles = readFileSync(
	resolve(process.cwd(), 'src/app/styles/globals.scss'),
	'utf8'
)
const tailwindConfig = readFileSync(
	resolve(process.cwd(), 'tailwind.config.ts'),
	'utf8'
)
const surfaces = ['bg', 'surface', 'surface-muted'] as const
const statuses = ['success', 'warning', 'danger', 'info'] as const
const textTokens = ['text', 'muted', 'primary', ...statuses] as const
const themes: Theme[] = ['light', 'dark']

function readPalette(theme: Theme): Record<string, Color> {
	const selector =
		theme === 'light'
			? /:root\s*\{([^}]+)\}/
			: /:root\[data-theme=['"]dark['"]\]\s*\{([^}]+)\}/
	const block = globalStyles.match(selector)?.[1]
	if (!block) throw new Error(`Missing ${theme} CRM palette`)
	return Object.fromEntries(
		[...block.matchAll(/\[--crm-([a-z-]+):(\d+)_(\d+)_(\d+)\]/g)].map(
			([, name, red, green, blue]) => [
				name,
				[Number(red), Number(green), Number(blue)] as Color
			]
		)
	)
}

function readFixedColor(name: string): Color {
	const value = tailwindConfig.match(
		new RegExp(`['"]?${name}['"]?:\\s*['"]#([\\da-f]{6})['"]`, 'i')
	)?.[1]
	if (!value) throw new Error(`Missing fixed CRM color: ${name}`)
	return [
		Number.parseInt(value.slice(0, 2), 16),
		Number.parseInt(value.slice(2, 4), 16),
		Number.parseInt(value.slice(4, 6), 16)
	]
}

function blend(
	foreground: Color,
	background: Color,
	opacity: number
): Color {
	return [
		foreground[0] * opacity + background[0] * (1 - opacity),
		foreground[1] * opacity + background[1] * (1 - opacity),
		foreground[2] * opacity + background[2] * (1 - opacity)
	]
}

function luminance(color: Color): number {
	const linear = color.map(channel => {
		const value = channel / 255
		return value <= 0.04045
			? value / 12.92
			: ((value + 0.055) / 1.055) ** 2.4
	})
	return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrast(foreground: Color, background: Color): number {
	const first = luminance(foreground)
	const second = luminance(background)
	return (
		(Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
	)
}

function expectReadable(
	foreground: Color,
	background: Color,
	label: string
) {
	const ratio = contrast(foreground, background)
	expect(
		ratio,
		`${label}: ${ratio.toFixed(2)}:1, expected at least 4.5:1`
	).toBeGreaterThanOrEqual(4.5)
}

describe.each(themes)('WinCRM %s palette contrast', theme => {
	const palette = readPalette(theme)

	it('defines valid RGB values for every tested semantic token', () => {
		for (const token of [...surfaces, ...textTokens]) {
			expect(palette[token], token).toHaveLength(3)
			for (const channel of palette[token]) {
				expect(Number.isInteger(channel), token).toBe(true)
				expect(channel, token).toBeGreaterThanOrEqual(0)
				expect(channel, token).toBeLessThanOrEqual(255)
			}
		}
	})

	it.each(surfaces)('keeps normal text AA-readable on crm-%s', surface => {
		for (const token of textTokens) {
			expectReadable(
				palette[token],
				palette[surface],
				`${theme} crm-${token} on crm-${surface}`
			)
		}
	})

	it.each(surfaces)(
		'keeps status text AA-readable on its 10-percent tint over crm-%s',
		surface => {
			for (const token of statuses) {
				expectReadable(
					palette[token],
					blend(palette[token], palette[surface], 0.1),
					`${theme} crm-${token} on crm-${token}/10 over crm-${surface}`
				)
			}
		}
	)

	it.each(surfaces)(
		'keeps filled actions AA-readable over crm-%s, including hover',
		surface => {
			for (const token of ['crm-action', 'crm-action-danger']) {
				for (const opacity of [1, 0.9]) {
					expectReadable(
						[255, 255, 255],
						blend(readFixedColor(token), palette[surface], opacity),
						`${theme} white on ${token} at ${opacity} over crm-${surface}`
					)
				}
			}
			for (const opacity of [1, 0.85]) {
				expectReadable(
					readFixedColor('secondary'),
					blend(readFixedColor('accent'), palette[surface], opacity),
					`${theme} secondary on accent at ${opacity} over crm-${surface}`
				)
			}
		}
	)
})

// The fixed brand wordmark is intentionally not a normal-text token. Its
// unchanged identity color has a separate regression test in BrandLogo.test.tsx.
