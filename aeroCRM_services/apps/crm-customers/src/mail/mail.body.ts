import { BadRequestException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';

const bodyLimit = 24576;
const safeHref = (value: string): string | null => {
	if (/[\x00-\x1f\x7f]/.test(value) || value.startsWith('//')) return null;
	try {
		const url = new URL(value);
		return ['http:', 'https:', 'mailto:'].includes(url.protocol)
			? url.href
			: null;
	} catch {
		return null;
	}
};

export function prepareMailBody(input: { text: string; html?: string }) {
	if (input.html === undefined) return { text: input.text, html: null };
	if (typeof input.html !== 'string')
		throw new BadRequestException({ code: 'crm_mail_compose_invalid' });
	if (
		Buffer.byteLength(input.text, 'utf8') +
			Buffer.byteLength(input.html, 'utf8') >
		bodyLimit
	)
		throw new BadRequestException({ code: 'crm_mail_compose_invalid' });
	const html = sanitizeHtml(input.html, {
		allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
		allowedAttributes: { a: ['href'] },
		allowedSchemes: ['http', 'https', 'mailto'],
		allowProtocolRelative: false,
		parseStyleAttributes: false,
		disallowedTagsMode: 'discard',
		transformTags: {
			a: (_tag, attrs) => {
				const href = attrs.href ? safeHref(attrs.href) : null;
				const attribs: Record<string, string> = {};
				if (href) attribs.href = href;
				return { tagName: 'a', attribs };
			}
		}
	});
	const text = convert(html, { wordwrap: false, preserveNewlines: true });
	if (
		Buffer.byteLength(text, 'utf8') + Buffer.byteLength(html, 'utf8') >
		bodyLimit
	)
		throw new BadRequestException({ code: 'crm_mail_compose_invalid' });
	return { text, html };
}
