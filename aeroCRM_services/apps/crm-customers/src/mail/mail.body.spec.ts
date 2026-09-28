import { BadRequestException } from '@nestjs/common';
import { prepareMailBody } from './mail.body';

describe('bounded outgoing rich mail body', () => {
	it('leaves legacy plain text byte-for-byte unchanged', () => {
		expect(prepareMailBody({ text: '  <b>Literal</b>\nПривет & goodbye  ' })).toEqual({
			text: '  <b>Literal</b>\nПривет & goodbye  ', html: null
		});
	});
	it('derives the fallback from sanitized content, preserving lists and link destinations', () => {
		const result = prepareMailBody({
			text: 'An unrelated client fallback must not be sent',
			html: '<p>Hello <strong>Анна</strong> &amp; team</p><ol><li>First</li><li><em>Second</em></li></ol><p><a href="https://example.org/offer?a=1&amp;b=2">Offer</a></p>'
		});
		expect(result.html).toContain('<strong>Анна</strong>');
		expect(result.text).toContain('Hello Анна & team');
		expect(result.text).toContain('First');
		expect(result.text).toContain('Second');
		expect(result.text).toContain('https://example.org/offer?a=1&b=2');
		expect(result.text).not.toContain('unrelated');
	});
	it.each([
		'javascript:alert(1)', 'JaVaScRiPt:alert(1)', '&#x6a;avascript:alert(1)',
		'&#0000106;avascript:alert(1)', 'java&#9;script:alert(1)', 'java&#10;script:alert(1)',
		'data:text/html,test', 'vbscript:test', 'file:///etc/passwd', 'blob:https://example.org/id',
		'//example.org/remote', '/relative', '#fragment'
	])('removes unsafe or relative href %s while retaining visible link text', href => {
		const body = prepareMailBody({ text: '', html: `<p><a href="${href}">Visible link</a></p>` });
		expect(body.html).toBe('<p><a>Visible link</a></p>');
		expect(body.text).toBe('Visible link');
	});
	it.each(['https://example.org/a', 'http://example.org/a', 'mailto:person@example.org'])(
		'preserves an allowed absolute destination %s', href => {
			expect(prepareMailBody({ text: '', html: `<a href="${href}">Link</a>` }).html).toBe(`<a href="${href}">Link</a>`);
		}
	);
	it.each([
		'<textarea></textarea/><img src=x onerror="alert(1)">',
		'<xmp></xmp/><img src=x onerror="alert(1)">',
		'<svg><a href="https://example.org"><animate attributeName="href" values="https://example.org;javascript:alert(1)" /><text>link</text></a></svg>',
		'<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
		'<p style="background:url(https://tracker.example.org)" onclick="alert(1)">Safe<img src="https://tracker.example.org"><script>alert(1)</script><iframe src="https://example.org"></iframe></p>'
	])('cannot emit active content from raw-text, foreign namespace or event payloads', html => {
		const body = prepareMailBody({ text: '', html });
		expect(body.html).not.toMatch(/<(?:textarea|xmp|svg|math|animate|img|script|style|iframe|form|input)\b/i);
		expect(body.html).not.toMatch(/\s(?:on[a-z]+|style|src|attributeName|values)\s*=/i);
		expect(body.html).not.toContain('javascript:');
	});
	it('rejects combined UTF-8 overflow before and after deriving plain fallback', () => {
		expect(() => prepareMailBody({ text: 'я'.repeat(6144), html: 'я'.repeat(6145) })).toThrow(BadRequestException);
		expect(() => prepareMailBody({ text: '', html: `<p>${'x'.repeat(13000)}</p>` })).toThrow(BadRequestException);
	});
});
