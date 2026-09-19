import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/og', () => ({
	ImageResponse: class {
		constructor(
			public element: ReactElement,
			public options: { width: number; height: number }
		) {}
	}
}))

import Icon, { contentType, size } from './icon'
import AppleIcon, {
	contentType as appleContentType,
	size as appleSize
} from './apple-icon'
import { BrandLogo } from '@/shared/ui/brand-logo/BrandLogo'

describe('WinCRM browser icons', () => {
	it.each([
		{ render: Icon, dimensions: size, type: contentType, pixels: 32 },
		{
			render: AppleIcon,
			dimensions: appleSize,
			type: appleContentType,
			pixels: 180
		}
	])(
		'provides a font-independent $pixels px PNG for public metadata',
		({ render, dimensions, type, pixels }) => {
			const response = render() as unknown as {
				element: ReactElement
				options: { width: number; height: number }
			}
			expect(type).toBe('image/png')
			expect(dimensions).toEqual({ width: pixels, height: pixels })
			expect(response.options).toEqual(dimensions)
			const html = renderToStaticMarkup(response.element)
			expect(html).toContain(`width="${pixels}" height="${pixels}"`)
			expect(html).toContain('fill="#7b3fa0"')
			expect(html).toContain('fill="#ffffff"')
			expect(html).not.toMatch(/<text|<image|<foreignObject/)
			const iconPath = html.match(/\bd="([^"]+)"/)![1]
			const wordmarkPath = renderToStaticMarkup(<BrandLogo />).match(
				/\bd="([^"]+)"/
			)![1]
			expect(wordmarkPath.startsWith(iconPath)).toBe(true)
		}
	)
})
