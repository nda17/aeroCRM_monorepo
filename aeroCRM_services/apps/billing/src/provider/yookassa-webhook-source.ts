import { BlockList, isIP } from 'node:net';

// Official YooKassa webhook networks, checked 2026-10-15:
// https://yookassa.ru/developers/using-api/webhooks
// The caller must supply Express request.ip after the trusted proxy chain,
// never a body field or an untrusted forwarded header.
const sources = new BlockList();
sources.addSubnet('185.71.76.0', 27, 'ipv4');
sources.addSubnet('185.71.77.0', 27, 'ipv4');
sources.addSubnet('77.75.153.0', 25, 'ipv4');
sources.addAddress('77.75.156.11', 'ipv4');
sources.addAddress('77.75.156.35', 'ipv4');
sources.addSubnet('77.75.154.128', 25, 'ipv4');
sources.addSubnet('2a02:5180::', 32, 'ipv6');

export function isYooKassaWebhookSource(value: unknown): boolean {
	if (typeof value !== 'string' || value.length > 64) return false;
	const family = isIP(value);
	return family !== 0 && sources.check(value, family === 4 ? 'ipv4' : 'ipv6');
}
