'use client'

import { createElement, useMemo, type ReactNode } from 'react'
import { isSafeMailLink } from '../model/mail-rich-text'
import styles from './Mail.module.scss'

const allowed = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'])
const blocked = new Set([
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'svg',
	'math',
	'img',
	'video',
	'audio',
	'form',
	'input'
])

export const MailRichText = ({
	html,
	text
}: {
	html: string
	text: string | null
}) => {
	const content = useMemo(() => {
		if (typeof document === 'undefined') return text
		// The template is inert and never attached. Only whitelisted React nodes
		// and one validated href attribute are copied into the rendered document.
		const template = document.createElement('template')
		template.innerHTML = html
		const render = (node: Node, key: string, depth: number): ReactNode => {
			if (depth > 40) return null
			if (node.nodeType === Node.TEXT_NODE) return node.textContent
			if (!(node instanceof HTMLElement)) return null
			const tag = node.tagName.toLowerCase()
			if (blocked.has(tag)) return null
			const children = Array.from(node.childNodes, (child, index) =>
				render(child, `${key}:${index}`, depth + 1)
			)
			if (!allowed.has(tag)) return children
			if (tag === 'br') return createElement('br', { key })
			if (tag === 'a') {
				const href = node.getAttribute('href') ?? ''
				return isSafeMailLink(href)
					? createElement(
							'a',
							{ key, href, target: '_blank', rel: 'noopener noreferrer' },
							children
						)
					: children
			}
			return createElement(tag, { key }, children)
		}
		return Array.from(template.content.childNodes, (node, index) =>
			render(node, String(index), 0)
		)
	}, [html, text])
	return <div className={styles.richPreview}>{content}</div>
}
