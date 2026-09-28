import { Injectable } from '@nestjs/common';
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes
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
@Injectable()
export class MailConfig {
	readonly enabled = flag('CRM_MAIL_ENABLED');
	readonly syncEnabled = flag('CRM_MAIL_SYNC_ENABLED');
	readonly sendEnabled = flag('CRM_MAIL_SEND_ENABLED');
	readonly keyId = process.env.CRM_MAIL_CREDENTIAL_KEY_ID || '';
	readonly key: Buffer;
	readonly attachmentsAvailable: boolean;
	constructor() {
		const keyValue = process.env.CRM_MAIL_CREDENTIAL_KEY || '';
		this.key = Buffer.from(keyValue, 'base64');
		if (
			this.enabled &&
			(this.key.length !== 32 ||
				!/^[A-Za-z0-9+/]{43}=$/.test(keyValue) ||
				this.key.toString('base64') !== keyValue ||
				!/^[a-zA-Z0-9_-]{1,80}$/.test(this.keyId))
		)
			throw new Error('Mail credential key configuration invalid');
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
		const cipher = createCipheriv('aes-256-gcm', this.key, iv);
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
		if (extra.length || kid !== this.keyId)
			throw new Error('MAIL_CREDENTIAL_KEY_UNAVAILABLE');
		const decipher = createDecipheriv(
			'aes-256-gcm',
			this.key,
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
	keyedDigest(value: unknown): string {
		return createHmac('sha256', this.key)
			.update(canonicalMailJson(value))
			.digest('hex');
	}
}
