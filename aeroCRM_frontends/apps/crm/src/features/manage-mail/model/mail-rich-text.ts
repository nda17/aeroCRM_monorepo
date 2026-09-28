import type { JSONContent } from '@tiptap/react'

export const isSafeMailLink = (value: string) => {
	if (!value || /[\s\u0000-\u001f\u007f]/.test(value)) return false
	try {
		const url = new URL(value)
		return ['http:', 'https:', 'mailto:'].includes(url.protocol)
	} catch {
		return false
	}
}

const escapeHtml = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')

// Serialize the editor schema explicitly: pasted attributes and extensions cannot
// introduce HTML outside the mail contract.
export const serializeMailRichText = (node: JSONContent): string => {
	if (node.type === 'text') {
		let content = escapeHtml(node.text ?? '')
		for (const mark of node.marks ?? []) {
			if (mark.type === 'bold') content = `<strong>${content}</strong>`
			else if (mark.type === 'italic') content = `<em>${content}</em>`
			else if (
				mark.type === 'link' &&
				typeof mark.attrs?.href === 'string' &&
				isSafeMailLink(mark.attrs.href)
			)
				content = `<a href="${escapeHtml(mark.attrs.href)}">${content}</a>`
		}
		return content
	}
	if (node.type === 'hardBreak') return '<br>'
	const children = (node.content ?? []).map(serializeMailRichText).join('')
	const tags: Record<string, string> = {
		paragraph: 'p',
		bulletList: 'ul',
		orderedList: 'ol',
		listItem: 'li'
	}
	const tag = tags[node.type ?? '']
	return tag ? `<${tag}>${children}</${tag}>` : children
}
