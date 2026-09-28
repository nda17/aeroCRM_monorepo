import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import ipaddr from 'ipaddr.js';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailConnection, MailMailbox } from '@prisma/crm-customers-client';
import { MailConfig, digest, canonicalMailJson } from './mail.config';

export interface MailTransportEndpoint {
	host: string;
	port: number;
	security: 'TLS' | 'STARTTLS';
	username: string;
}
export interface MailTransportConfiguration {
	imap: MailTransportEndpoint;
	smtp: MailTransportEndpoint;
}
export interface MailCredentials {
	password: string;
	smtpPassword: string;
}
export function endpoint(
	value: MailTransportEndpoint,
	kind: 'imap' | 'smtp'
): MailTransportEndpoint {
	const host = domainToASCII(value.host.toLowerCase().trim());
	if (
		host !== value.host ||
		host.length > 253 ||
		isIP(host) ||
		!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
			host
		) ||
		/(?:\.localhost|\.local|\.internal|\.test|\.invalid|\.example)$/.test(host)
	)
		throw new BadRequestException({ code: 'crm_mail_invalid_host' });
	const allowed =
		kind === 'imap'
			? value.security === 'TLS'
				? [993]
				: [143]
			: value.security === 'TLS'
				? [465]
				: [25, 587, 2525];
	if (
		!['TLS', 'STARTTLS'].includes(value.security) ||
		!allowed.includes(value.port) ||
		!value.username ||
		value.username.length > 254 ||
		/[\x00-\x1f\x7f]/.test(value.username)
	)
		throw new BadRequestException({ code: 'crm_mail_invalid_transport' });
	return {
		host,
		port: value.port,
		security: value.security,
		username: value.username
	};
}
export function publicMailAddress(value: string): boolean {
	if (!ipaddr.isValid(value)) return false;
	const parsed = ipaddr.parse(value);
	if (parsed.range() !== 'unicast') return false;
	if (parsed.kind() === 'ipv6') {
		const address = parsed as ipaddr.IPv6;
		if (address.isIPv4MappedAddress()) return false;
		if (!address.match(ipaddr.parseCIDR('2000::/3'))) return false;
		return ![
			'2001::/23',
			'2001:db8::/32',
			'2002::/16',
			'3fff::/20',
			'3ffe::/16'
		].some((cidr) => address.match(ipaddr.parseCIDR(cidr)));
	}
	const address = parsed as ipaddr.IPv4;
	return ![
		'192.0.0.0/24',
		'192.0.2.0/24',
		'192.88.99.0/24',
		'198.18.0.0/15',
		'198.51.100.0/24',
		'203.0.113.0/24'
	].some((cidr) => address.match(ipaddr.parseCIDR(cidr)));
}
export async function resolveMailEndpoint(host: string): Promise<string> {
	const answers = await lookup(host, { all: true, verbatim: true });
	if (
		!answers.length ||
		answers.length > 16 ||
		answers.some((answer) => !publicMailAddress(answer.address))
	)
		throw new Error('MAIL_HOST_NOT_PUBLIC');
	return (answers.find((answer) => answer.family === 4) || answers[0]).address;
}
@Injectable()
export class MailTransport {
	constructor(private readonly config: MailConfig) {}
	credentials(connection: MailConnection): MailCredentials {
		if (connection.state !== 'ACTIVE' || !connection.encryptedSecret)
			throw new Error('MAIL_RECONNECT_REQUIRED');
		return this.config.decrypt<MailCredentials>(
			connection.encryptedSecret,
			this.config.aad(
				connection.workspaceId,
				connection.id,
				connection.credentialPrincipal,
				connection.generation,
				digest(canonicalMailJson(connection.transport))
			)
		);
	}
	configuration(connection: MailConnection): MailTransportConfiguration {
		const transport =
			connection.transport as unknown as MailTransportConfiguration;
		return {
			imap: endpoint(transport.imap, 'imap'),
			smtp: endpoint(transport.smtp, 'smtp')
		};
	}
	async imap(
		transport: MailTransportEndpoint,
		password: string
	): Promise<ImapFlow> {
		const ep = endpoint(transport, 'imap');
		const host = await resolveMailEndpoint(ep.host);
		const client = new ImapFlow({
			host,
			port: ep.port,
			secure: ep.security === 'TLS',
			servername: ep.host,
			doSTARTTLS: ep.security === 'STARTTLS',
			tls: {
				servername: ep.host,
				rejectUnauthorized: true,
				minVersion: 'TLSv1.2'
			},
			auth: { user: ep.username, pass: password },
			logger: false,
			logRaw: false,
			maxLineLength: 65536,
			maxLiteralSize: 512 * 1024,
			maxResponseSize: 1024 * 1024,
			disableCompression: true,
			disableAutoIdle: true,
			disableAutoEnable: true,
			connectionTimeout: 15000,
			greetingTimeout: 15000,
			socketTimeout: 30000
		});
		client.on('error', () => undefined);
		try {
			await client.connect();
			if (!client.secureConnection) throw new Error('MAIL_TLS_REQUIRED');
			return client;
		} catch (error) {
			client.close();
			throw error;
		}
	}
	async smtp(transport: MailTransportEndpoint, password: string) {
		const ep = endpoint(transport, 'smtp');
		const host = await resolveMailEndpoint(ep.host);
		return nodemailer.createTransport({
			host,
			port: ep.port,
			secure: ep.security === 'TLS',
			requireTLS: ep.security === 'STARTTLS',
			ignoreTLS: false,
			tls: {
				servername: ep.host,
				rejectUnauthorized: true,
				minVersion: 'TLSv1.2'
			},
			auth: { user: ep.username, pass: password },
			connectionTimeout: 15000,
			greetingTimeout: 15000,
			socketTimeout: 30000,
			logger: false,
			debug: false,
			disableFileAccess: true,
			disableUrlAccess: true
		});
	}
	async probe(
		transport: MailTransportConfiguration,
		credentials: MailCredentials
	): Promise<void> {
		const client = await this.imap(transport.imap, credentials.password);
		try {
			await client.list();
		} finally {
			await client.logout().catch(() => client.close());
		}
		const smtp = await this.smtp(transport.smtp, credentials.smtpPassword);
		try {
			await smtp.verify();
		} finally {
			smtp.close();
		}
	}
	async folders(connection: MailConnection) {
		const creds = this.credentials(connection);
		const transport = this.configuration(connection);
		const client = await this.imap(transport.imap, creds.password);
		try {
			return await client.list();
		} finally {
			await client.logout().catch(() => client.close());
		}
	}
	async mime(
		mailbox: MailMailbox,
		input: {
			to: unknown[];
			cc: unknown[];
			bcc: unknown[];
			subject: string;
			text: string;
			messageId: string;
			inReplyTo?: string;
			references?: string[];
			attachments: Array<{
				filename: string;
				content: Buffer;
				contentType: string;
			}>;
		}
	): Promise<Buffer> {
		const composer = new MailComposer({
			from: { address: mailbox.canonicalAddress, name: mailbox.displayName },
			to: input.to as never,
			cc: input.cc as never,
			bcc: input.bcc as never,
			subject: input.subject,
			text: input.text,
			messageId: input.messageId,
			inReplyTo: input.inReplyTo,
			references: input.references,
			attachments: input.attachments,
			date: new Date(),
			disableFileAccess: true,
			disableUrlAccess: true,
			keepBcc: false
		});
		return new Promise((resolve, reject) =>
			composer
				.compile()
				.build((error: Error | null, bytes: Buffer) =>
					error ? reject(error) : resolve(bytes)
				)
		);
	}
}
