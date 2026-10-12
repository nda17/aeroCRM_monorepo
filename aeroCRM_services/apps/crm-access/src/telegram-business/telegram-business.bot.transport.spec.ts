import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, request, createServer } from 'node:https';
import { type AddressInfo, type LookupFunction } from 'node:net';
import { telegramApiProxyLookup } from './telegram-business.bot';

describe('Telegram API proxy lookup', () => {
	it('completes real HTTPS requests for Node all-address and single-address lookups', async () => {
		const fixtureDirectory = mkdtempSync(join(tmpdir(), 'telegram-https-test-'));
		execFileSync('openssl', [
			'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
			'-keyout', join(fixtureDirectory, 'local-https.key'),
			'-out', join(fixtureDirectory, 'local-https.crt'),
			'-days', '1', '-subj', '/CN=telegram-test.local',
			'-addext', 'subjectAltName=DNS:telegram-test.local'
		], { stdio: 'ignore' });
		const server = createServer({
			key: readFileSync(join(fixtureDirectory, 'local-https.key')),
			cert: readFileSync(join(fixtureDirectory, 'local-https.crt'))
		}, (_request, response) => {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ ok: true, result: { id: 41, username: 'local_test_bot' } }));
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});

		try {
			const { port } = server.address() as AddressInfo;
			const lookupOptionsAll: boolean[] = [];
			const proxyLookup = telegramApiProxyLookup('127.0.0.1');
			const observedLookup: LookupFunction = (hostname, options, callback) => {
				lookupOptionsAll.push(options.all === true);
				proxyLookup(hostname, options, callback);
			};
			const makeRequest = (family: 0 | 4) => new Promise<string>((resolve, reject) => {
				const outgoing = request({
					hostname: 'telegram-test.local',
					port,
					path: '/telegram-api/bot-local-token/getMe',
					method: 'POST',
					family,
					agent: new Agent({ autoSelectFamily: true }),
					lookup: observedLookup,
					rejectUnauthorized: false
				}, incoming => {
					const chunks: Buffer[] = [];
					incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
					incoming.on('end', () => {
						if (incoming.statusCode !== 200) reject(new Error(`Unexpected HTTPS status: ${incoming.statusCode}`));
						else resolve(Buffer.concat(chunks).toString('utf8'));
					});
				});
				outgoing.once('error', reject);
				outgoing.setTimeout(3000, () => outgoing.destroy(new Error('Local HTTPS test request timed out')));
				outgoing.end('{}');
			});
			const allAddressesBody = await makeRequest(0);
			const singleAddressBody = await makeRequest(4);

			expect(JSON.parse(allAddressesBody)).toEqual({ ok: true, result: { id: 41, username: 'local_test_bot' } });
			expect(JSON.parse(singleAddressBody)).toEqual({ ok: true, result: { id: 41, username: 'local_test_bot' } });
			expect(lookupOptionsAll).toContain(true);
			expect(lookupOptionsAll).toContain(false);
		} finally {
			try {
				await new Promise<void>((resolve, reject) => {
					server.close(error => error ? reject(error) : resolve());
				});
			} finally {
				rmSync(fixtureDirectory, { recursive: true, force: true });
			}
		}
	});
});
