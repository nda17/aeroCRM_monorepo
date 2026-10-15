import { randomBytes } from 'node:crypto'
import { API_URL } from '@/shared/config/api.config'

export const dynamic = 'force-dynamic'

/** A route response deliberately bypasses the site's CMS scripts and providers. */
export function GET() {
	const nonce = randomBytes(18).toString('base64')
	const endpoint = `${API_URL.replace(/\/$/, '')}/marketing/email/unsubscribe`
	const apiOrigin = new URL(endpoint).origin
	const endpointJson = JSON.stringify(endpoint).replace(/</g, '\\u003c')
	const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>Отписка от писем aeroCRM</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#1e293b;font:16px/1.6 system-ui,sans-serif}main{max-width:36rem;margin:10vh auto;padding:2rem;background:white;border:1px solid #e2e8f0;border-radius:1rem}h1{font-size:1.6rem;line-height:1.3}button{min-height:44px;padding:.75rem 1rem;border:0;border-radius:.5rem;background:#6d28d9;color:white;font:inherit;font-weight:600;cursor:pointer}button:focus-visible{outline:3px solid #8b5cf6;outline-offset:3px}button:disabled{opacity:.65;cursor:wait}p{overflow-wrap:anywhere}small{display:block;margin-top:1rem;color:#64748b}@media(max-width:600px){main{margin:1rem;padding:1.25rem}button{width:100%}}</style></head>
<body><main><h1>Отписка от новостей и предложений</h1><p>Подтвердите, что хотите отказаться от маркетинговых писем aeroCRM. Коды входа и необходимые сообщения о работе сервиса продолжат приходить.</p><button id="confirm" type="button">Отписаться от маркетинговых писем</button><p id="result" role="status" aria-live="polite"></p><small>Открытие этой страницы само по себе не меняет настройки.</small></main>
<script nonce="${nonce}">document.getElementById('confirm').addEventListener('click',async function(){const button=this;const result=document.getElementById('result');button.disabled=true;result.textContent='Обрабатываем запрос…';try{const token=new URLSearchParams(window.location.hash.slice(1)).get('token')||'';const response=await fetch(${endpointJson},{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!response.ok)throw new Error();const data=await response.json();if(!data||data.ok!==true||Object.keys(data).length!==1)throw new Error();result.textContent='Запрос на отписку обработан';button.hidden=true;window.history.replaceState(null,'',window.location.pathname);}catch{result.textContent='Не удалось обработать запрос. Попробуйте ещё раз.';button.disabled=false;}});</script></body></html>`
	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store, max-age=0',
			'X-Robots-Tag': 'noindex, nofollow, noarchive',
			'Referrer-Policy': 'no-referrer',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src ${apiOrigin}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
		}
	})
}
