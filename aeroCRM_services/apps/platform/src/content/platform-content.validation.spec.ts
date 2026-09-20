import { BadRequestException } from '@nestjs/common';
import {
	sanitizeLegalHtml,
	validateAndSanitizeStructuredHomeContent,
	validateRawHomeContent
} from './platform-content.validation';


describe('Platform content validation', () => {
	it('removes executable legal markup and every dangerous URL form', () => {
		const sanitized = sanitizeLegalHtml(
			'<p onclick="alert(1)">Text</p>' +
				'<script>alert(1)</script><iframe src="https://attacker.test"></iframe>' +
				'<img src="x" onerror="alert(1)">' +
				'<a href="javascript:alert(1)">javascript</a>' +
				'<a href="data:text/html;base64,PHNjcmlwdD4=">data</a>' +
				'<a href="//attacker.test/path">protocol-relative</a>'
		);
		expect(sanitized).toBe(
			'<p>Text</p><a>javascript</a><a>data</a><a>protocol-relative</a>'
		);
	});

	it('drops the SVG SMIL URL-list payload from GHSA-g8qq-57p8-ggw5', () => {
		const sanitized = sanitizeLegalHtml(
			'<svg><a><animate attributeName="href" values="#safe;javascript:alert(1)" dur=".01s" fill="freeze"></animate>' +
				'<set attributeName="xlink:href" from="#safe" to="javascript:alert(2)"></set>' +
				'<text y="30">safe</text></a></svg>'
		);

		expect(sanitized).toBe('<a>safe</a>');
	});

	it.each(['textarea', 'xmp'])(
		'drops the %s raw-text payload from GHSA-jxwj-j7wr-gfrw',
		tag => {
			expect(
				sanitizeLegalHtml(
					`<${tag}></${tag}/><img src=x onerror="alert(document.domain)">`
				)
			).toBe('');
		}
	);

	it('preserves the explicit legal TipTap tag allowlist', () => {
		expect(
			sanitizeLegalHtml(
				'<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4>' +
					'<p>Text<br><strong>strong</strong><em>em</em><u>u</u><s>s</s><code>code</code></p>' +
					'<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>quote</blockquote>' +
					'<section data-aerocrm-section="renewal" class="unsupported">section</section>'
			)
		).toBe(
			'<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4>' +
				'<p>Text<br /><strong>strong</strong><em>em</em><u>u</u><s>s</s><code>code</code></p>' +
				'<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>quote</blockquote>' +
				'<section data-aerocrm-section="renewal">section</section>'
		);
	});

	it('canonicalizes target blank links and drops unsupported link attributes', () => {
		expect(
			sanitizeLegalHtml(
				'<a href="https://aerocrm.space/legal" target="_blank" rel="opener" onclick="alert(1)">safe</a>' +
					'<a href="mailto:support@aerocrm.space">mail</a><a href="tel:+79991234567">phone</a>'
			)
		).toBe(
			'<a href="https://aerocrm.space/legal" target="_blank" rel="noopener noreferrer">safe</a>' +
				'<a href="mailto:support@aerocrm.space">mail</a><a href="tel:+79991234567">phone</a>'
		);
	});

	it('preserves only the current TipTap heading and alignment output', () => {
		expect(
			sanitizeLegalHtml(
				'<h1 style="text-align: center">Title</h1><p style="text-align: right">Text</p>'
			)
		).toBe(
			'<h1 style="text-align:center">Title</h1><p style="text-align:right">Text</p>'
		);
	});

	it('strips hostile and unsupported inline styles', () => {
		expect(
			sanitizeLegalHtml(
				'<h2 style="text-align:justify;color:red;background:url(javascript:alert(1))">Title</h2><div style="text-align:center">Text</div>'
			)
		).toBe('<h2>Title</h2>Text');
	});

	it('accepts the exact raw-code contract', () => {
		expect(
			validateRawHomeContent({
				head: { enabled: true, html: '<meta name="x" content="y">' },
				body: { enabled: false, html: '' }
			})
		).toEqual({
			head: { enabled: true, html: '<meta name="x" content="y">' },
			body: { enabled: false, html: '' }
		});
	});

	it('rejects structured fields in the DEV raw-code contract', () => {
		expect(() =>
			validateRawHomeContent({
				head: { enabled: true, html: '' },
				body: { enabled: false, html: '' },
				hero: {}
			})
		).toThrow(BadRequestException);
	});

	it('rejects head/body in the ADMIN structured contract', () => {
		expect(() =>
			validateAndSanitizeStructuredHomeContent({
				head: { enabled: true, html: '<script>bad()</script>' }
			})
		).toThrow('Invalid structured field: content.head');
	});

	it('rejects removed widget content in the CRM CMS', () => {
		expect(() => validateAndSanitizeStructuredHomeContent({ demoWidgets: {} }))
			.toThrow('Invalid structured field: content.demoWidgets');
	});

});
