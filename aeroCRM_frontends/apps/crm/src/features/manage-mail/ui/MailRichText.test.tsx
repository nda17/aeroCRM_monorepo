import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	isSafeMailLink,
	serializeMailRichText
} from '../model/mail-rich-text'
import { MailRichText } from './MailRichText'
import { RichMailEditor } from './RichMailEditor'

beforeEach(() => {
	// JSDOM has no layout implementation for the Range used by ProseMirror.
	Object.defineProperty(Range.prototype, 'getClientRects', {
		configurable: true,
		value: () => []
	})
	Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
		configurable: true,
		value: () => new DOMRect()
	})
})

describe('safe mail rich text', () => {
	it.each([
		'javascript:alert(1)',
		'data:text/html,test',
		'//example.org',
		'/relative',
		'https://example.org/\n',
		'mailto:a@example.org\r\nbcc:x@example.org'
	])('rejects unsafe link %s', value => {
		expect(isSafeMailLink(value)).toBe(false)
	})
	it('escapes text, limits formatting and serializes safe link destinations', () => {
		expect(
			serializeMailRichText({
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{
								type: 'text',
								text: '<hello>',
								marks: [
									{ type: 'bold' },
									{
										type: 'link',
										attrs: { href: 'https://example.org/?a=1&b=2' }
									}
								]
							}
						]
					}
				]
			})
		).toBe(
			'<p><a href="https://example.org/?a=1&amp;b=2"><strong>&lt;hello&gt;</strong></a></p>'
		)
	})
	it('renders only safe React nodes without tracking images or active attributes', () => {
		const { container } = render(
			<MailRichText
				text="fallback"
				html={
					'<p onclick="alert(1)" style="color:red"><strong>Safe</strong><img src="https://tracker.example/x"><svg><a href="javascript:alert(1)">SVG</a></svg><script>alert(1)</script><a href="javascript:alert(1)">unsafe</a><a href="https://example.org" onmouseover="alert(1)">safe link</a></p>'
				}
			/>
		)
		expect(container.querySelector('strong')?.textContent).toBe('Safe')
		expect(
			container.querySelectorAll(
				'img,svg,script,[style],[onclick],[onmouseover]'
			)
		).toHaveLength(0)
		expect(container.querySelectorAll('a')).toHaveLength(1)
		expect(container.querySelector('a')?.rel).toBe('noopener noreferrer')
	})
	it('preserves formatting across mode switches and removes it when plain text changes', async () => {
		function Harness() {
			const [value, setValue] = useState<{ text: string; html?: string }>({
				text: 'Hello'
			})
			return (
				<>
					<RichMailEditor
						{...value}
						disabled={false}
						onChange={setValue}
					/>
					<output data-testid="html">{value.html ?? 'plain'}</output>
				</>
			)
		}
		const { unmount } = render(<Harness />)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Маркированный список' })
		)
		await waitFor(() =>
			expect(screen.getByTestId('html').textContent).toContain(
				'<ul><li><p>Hello</p></li></ul>'
			)
		)
		fireEvent.click(screen.getByRole('button', { name: 'Обычный текст' }))
		expect(screen.getByTestId('html').textContent).toContain('<ul>')
		fireEvent.change(screen.getByLabelText('Письмо'), {
			target: { value: 'Changed' }
		})
		expect(screen.getByTestId('html').textContent).toBe('plain')
		unmount()
	})
})
