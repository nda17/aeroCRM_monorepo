import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrandLogo } from './BrandLogo'
import styles from './BrandLogo.module.scss'

afterEach(cleanup)

describe('aeroCRM wordmark', () => {
	it('renders one accessible SVG brand', () => {
		const { container } = render(<BrandLogo />)
		const svg = screen.getByRole('img', { name: 'aeroCRM' })
		expect(svg.getAttribute('viewBox')).toBe('0 0 278 66')
		expect(svg.classList.contains(styles.wordmark)).toBe(true)
		expect(container.querySelectorAll('svg')).toHaveLength(1)
	})

	it('keeps the link destination and caller styling', () => {
		render(<BrandLogo href="/inbox" className="custom-brand" />)
		const link = screen.getByRole('link', { name: 'aeroCRM' })
		expect(link.getAttribute('href')).toBe('/inbox')
		expect(link.classList.contains('custom-brand')).toBe(true)
		expect(link.classList.contains(styles.logo)).toBe(true)
	})
})
