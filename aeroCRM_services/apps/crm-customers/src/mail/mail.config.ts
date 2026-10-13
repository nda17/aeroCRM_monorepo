import { Injectable } from '@nestjs/common';
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';

export const MAIL_LIMITS = {
	maxFileBytes: 5 * 1024 * 1024,
	maxSendBytes: 10 * 1024 * 1024,
	maxFiles: 10,
	supportedMediaTypes: [
		'image/png',
		'image/jpeg',
		'image/webp',
		'application/pdf',
		'text/plain',
		'text/csv',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	]
};
export function canonicalMailJson(value: unknown): string {
	return JSON.stringify(value, (_key, item) =>
		item && typeof item === 'object' && !Array.isArray(item)
			? Object.fromEntries(
					Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
				)
			: item
	);
}
export function digest(bytes: string | Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}
export function flag(name: string): boolean {
	const value = process.env[name];
	if (value && !['true', 'false'].includes(value))
		throw new Error(`${name} must be true or false`);
	return value === 'true';
}
export function mailRole(): 'api' | 'mail-sync' | 'mail-send' {
	const role = process.env.CRM_CUSTOMERS_PROCESS_ROLE || 'api';
	if (!['api', 'mail-sync', 'mail-send'].includes(role))
		throw new Error('CRM_CUSTOMERS_PROCESS_ROLE is invalid');
	return role as 'api' | 'mail-sync' | 'mail-send';
}
export interface MailRequestHash {
	value: string;
	keyId: string | null;
	candidates: ReadonlyMap<string | null, string>;
}
const KEY_ID = /^[a-zA-Z0-9_-]{1,80}$/;
function readKey(value: unknown): Buffer {
	if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value))
		throw new Error('Mail keyring configuration invalid');
	const key = Buffer.from(value, 'base64');
	if (key.length !== 32 || key.toString('base64') !== value)
		throw new Error('Mail keyring configuration invalid');
	return key;
}
function readKeyring(
	name: string,
	activeName: string,
	legacyId: string,
	legacyKey: Buffer
) {
	const raw = process.env[name];
	const active = process.env[activeName];
	const keys = new Map<string, Buffer>([[legacyId, legacyKey]]);
	if (!raw && !active) return { keys, active: legacyId };
	try {
		if (!raw || raw.length > 8192 || !active || !KEY_ID.test(active))
			throw new Error();
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			throw new Error();
		const entries = Object.entries(parsed);
		if (!entries.length || entries.length > 10) throw new Error();
		for (const [id, value] of entries) {
			if (!KEY_ID.test(id)) throw new Error();
			const key = readKey(value);
			if (id === legacyId && !key.equals(legacyKey)) throw new Error();
			keys.set(id, key);
		}
		if (!keys.has(active)) throw new Error();
		return { keys, active };
	} catch {
		throw new Error('Mail keyring configuration invalid');
	}
}
@Injectable()
export class MailConfig {
	readonly enabled = flag('CRM_MAIL_ENABLED');
	readonly syncEnabled = flag('CRM_MAIL_SYNC_ENABLED');
	readonly sendEnabled = flag('CRM_MAIL_SEND_ENABLED');
	readonly legacyKeyId = process.env.CRM_MAIL_CREDENTIAL_KEY_ID || '';
	readonly keyId: string;
	readonly hmacKeyId: string | null;
	readonly key: Buffer;
	private readonly credentialKeys: Map<string, Buffer>;
	private readonly hmacKeys: Map<string, Buffer>;
	readonly rotationEnabled = flag('CRM_MAIL_KEY_ROTATION_ENABLED');
	readonly attachmentsAvailable: boolean;
	constructor() {
		const keyValue = process.env.CRM_MAIL_CREDENTIAL_KEY || '';
		this.key = Buffer.from(keyValue, 'base64');
		if (
			(this.enabled ||
				this.rotationEnabled ||
				process.env.CRM_MAIL_CREDENTIAL_KEYRING ||
				process.env.CRM_MAIL_HMAC_KEYRING) &&
			(this.key.length !== 32 ||
				!/^[A-Za-z0-9+/]{43}=$/.test(keyValue) ||
				this.key.toString('base64') !== keyValue ||
				!KEY_ID.test(this.legacyKeyId))
		)
			throw new Error('Mail credential key configuration invalid');
		const credentials = readKeyring(
			'CRM_MAIL_CREDENTIAL_KEYRING',
			'CRM_MAIL_CREDENTIAL_ACTIVE_KEY_ID',
			this.legacyKeyId,
			this.key
		);
		const hmac = readKeyring(
			'CRM_MAIL_HMAC_KEYRING',
			'CRM_MAIL_HMAC_ACTIVE_KEY_ID',
			this.legacyKeyId,
			this.key
		);
		this.credentialKeys = credentials.keys;
		this.keyId = credentials.active;
		this.hmacKeys = hmac.keys;
		this.hmacKeyId = hmac.active === this.legacyKeyId ? null : hmac.active;
		if (
			this.rotationEnabled &&
			(!this.enabled ||
				!process.env.CRM_MAIL_CREDENTIAL_KEYRING ||
				!process.env.CRM_MAIL_HMAC_KEYRING)
		)
			throw new Error('Mail rotation requires enabled mail and both keyrings');
		flag('CRM_MAIL_S3_FORCE_PATH_STYLE');
		const endpoint = process.env.CRM_MAIL_S3_ENDPOINT;
		const values = [
			endpoint,
			process.env.CRM_MAIL_S3_REGION,
			process.env.CRM_MAIL_S3_BUCKET,
			process.env.CRM_MAIL_S3_ACCESS_KEY_ID,
			process.env.CRM_MAIL_S3_SECRET_ACCESS_KEY
		];
		this.attachmentsAvailable = this.enabled && values.every(Boolean);
		if (values.some(Boolean) && !values.every(Boolean))
			throw new Error('Mail S3 configuration must be complete');
		if (endpoint) {
			const u = new URL(endpoint);
			if (
				u.protocol !== 'https:' ||
				u.username ||
				u.password ||
				u.search ||
				u.hash
			)
				throw new Error('Mail S3 endpoint must use HTTPS');
		}
		if ((this.syncEnabled || this.sendEnabled) && !this.enabled)
			throw new Error('Mail workers require CRM_MAIL_ENABLED');
	}
	aad(
		workspaceId: string,
		connectionId: string,
		principal: string,
		generation: number,
		settingsHash: string
	): string {
		return JSON.stringify([
			workspaceId,
			connectionId,
			principal,
			generation,
			settingsHash
		]);
	}
	encrypt(value: unknown, aad: string): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv(
			'aes-256-gcm',
			this.credentialKeys.get(this.keyId)!,
			iv
		);
		cipher.setAAD(Buffer.from(aad));
		const bytes = Buffer.concat([
			cipher.update(JSON.stringify(value), 'utf8'),
			cipher.final()
		]);
		return [
			this.keyId,
			iv.toString('base64'),
			cipher.getAuthTag().toString('base64'),
			bytes.toString('base64')
		].join('.');
	}
	decrypt<T>(value: string, aad: string): T {
		const [kid, iv, tag, bytes, ...extra] = value.split('.');
		const key = this.credentialKeys.get(kid);
		if (extra.length || !key || !iv || !tag || !bytes)
			throw new Error('MAIL_CREDENTIAL_KEY_UNAVAILABLE');
		const decipher = createDecipheriv(
			'aes-256-gcm',
			key,
			Buffer.from(iv, 'base64')
		);
		decipher.setAAD(Buffer.from(aad));
		decipher.setAuthTag(Buffer.from(tag, 'base64'));
		return JSON.parse(
			Buffer.concat([
				decipher.update(Buffer.from(bytes, 'base64')),
				decipher.final()
			]).toString('utf8')
		) as T;
	}
	keyedDigest(value: unknown, keyId: string | null = this.hmacKeyId): string {
		const key = this.hmacKeys.get(keyId ?? this.legacyKeyId);
		if (!key) throw new Error('MAIL_HMAC_KEY_UNAVAILABLE');
		return createHmac('sha256', key)
			.update(canonicalMailJson(value))
			.digest('hex');
	}
	requestHash(value: unknown): MailRequestHash {
		const candidates = new Map<string | null, string>();
		for (const id of this.hmacKeys.keys()) {
			const keyId = id === this.legacyKeyId ? null : id;
			candidates.set(keyId, this.keyedDigest(value, keyId));
		}
		return {
			value: candidates.get(this.hmacKeyId)!,
			keyId: this.hmacKeyId,
			candidates
		};
	}
	signCursor(payload: string): string {
		if (this.hmacKeyId === null)
			return `${payload}.${this.keyedDigest(payload, null)}`;
		return `v1.${this.hmacKeyId}.${payload}.${this.keyedDigest(['cursor:v1', this.hmacKeyId, payload])}`;
	}
	openCursor(value: string): string {
		const parts = value.split('.');
		let payload: string, submitted: string, expected: string;
		if (parts.length === 2) {
			[payload, submitted] = parts;
			expected = this.keyedDigest(payload, null);
		} else if (
			parts.length === 4 &&
			parts[0] === 'v1' &&
			KEY_ID.test(parts[1])
		) {
			const [, keyId, body, mac] = parts;
			payload = body;
			submitted = mac;
			expected = this.keyedDigest(['cursor:v1', keyId, payload], keyId);
		} else throw new Error('MAIL_CURSOR_INVALID');
		if (
			!/^[a-f0-9]{64}$/.test(submitted) ||
			!timingSafeEqual(
				Buffer.from(expected, 'hex'),
				Buffer.from(submitted, 'hex')
			)
		)
			throw new Error('MAIL_CURSOR_INVALID');
		return payload;
	}
}
