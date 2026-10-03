import {
	Injectable,
	OnApplicationShutdown,
	ServiceUnavailableException
} from '@nestjs/common';
import { UserStatus } from '@prisma/identity-client';
import { Client } from 'pg';
import type { Response } from 'express';
import { IdentityPrismaService } from '../prisma/identity-prisma.service';

const CHANNEL = 'identity_session_revoked_v1';
type Subscription = {
	sessionId: string;
	subject: string;
	response: Response;
	revoked: () => void;
};

/** Signals are delivered only after commit; the DB read after subscribing closes the initial race. */
@Injectable()
export class SessionEventsService implements OnApplicationShutdown {
	private client?: Client;
	private connecting?: Promise<void>;
	private stopped = false;
	private readonly subscriptions = new Set<Subscription>();
	constructor(private readonly prisma: IdentityPrismaService) {}

	private ensureListener(): Promise<void> {
		if (this.stopped)
			return Promise.reject(new ServiceUnavailableException());
		if (this.connecting) return this.connecting;
		if (this.client) return Promise.resolve();
		const value = process.env.IDENTITY_DATABASE_URL;
		if (!value) return Promise.reject(new ServiceUnavailableException());
		const client = new Client({
			connectionString: value,
			connectionTimeoutMillis: 3000,
			query_timeout: 3000,
			application_name: 'identity-session-listener',
			keepAlive: true,
			keepAliveInitialDelayMillis: 10000
		});
		this.client = client;
		const lost = () => {
			if (this.client !== client) return;
			this.client = undefined;
			for (const item of this.subscriptions) item.response.end();
			void client.end().catch(() => undefined);
		};
		client.on('error', lost);
		client.on('end', lost);
		client.on('notification', (notification) => {
			if (
				this.client !== client ||
				notification.channel !== CHANNEL ||
				!notification.payload ||
				notification.payload.length > 128
			)
				return;
			for (const item of this.subscriptions) {
				if (item.sessionId === notification.payload) item.revoked();
			}
		});
		this.connecting = (async () => {
			try {
				await client.connect();
				await client.query('LISTEN identity_session_revoked_v1');
				if (this.client !== client || this.stopped) throw new Error();
			} catch {
				lost();
				throw new ServiceUnavailableException(
					'Session events are temporarily unavailable'
				);
			} finally {
				this.connecting = undefined;
			}
		})();
		return this.connecting;
	}

	async open(
		sessionId: string,
		subject: string,
		expiresAt: number,
		response: Response
	): Promise<void> {
		await this.ensureListener();
		if (
			this.subscriptions.size >= 1000 ||
			[...this.subscriptions].filter((item) => item.subject === subject)
				.length >= 12
		)
			throw new ServiceUnavailableException(
				'Too many session connections'
			);
		if (response.destroyed || this.stopped) return;
		response
			.status(200)
			.set({
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-store, no-transform',
				'X-Accel-Buffering': 'no'
			});
		response.flushHeaders();
		let closed = false;
		let checking = false;
		const write = (event: string) => {
			if (!closed && !response.write('event: ' + event + '\ndata: {}\n\n'))
				response.end();
		};
		const revoked = () => {
			if (!closed) {
				write('revoked');
				response.end();
			}
		};
		const check = async (initial = false) => {
			if (closed || checking) return;
			if (Date.now() >= expiresAt) {
				response.end();
				return;
			}
			checking = true;
			try {
				const session = await this.prisma.userSession.findFirst({
					where: { id: sessionId, userId: subject },
					include: { user: true }
				});
				if (closed) return;
				if (
					!session ||
					session.revokedAt ||
					session.expiresAt <= new Date() ||
					session.user.status !== UserStatus.ACTIVE ||
					session.user.deletedAt
				)
					revoked();
				else if (Date.now() >= expiresAt) response.end();
				else write(initial ? 'ready' : 'heartbeat');
			} catch {
				response.end();
			} finally {
				checking = false;
			}
		};
		const subscription = { sessionId, subject, response, revoked };
		this.subscriptions.add(subscription);
		const heartbeat = setInterval(() => void check(), 5000);
		const lifetime = setTimeout(
			() => response.end(),
			Math.max(1, Math.min(300000, expiresAt - Date.now()))
		);
		const close = () => {
			closed = true;
			clearInterval(heartbeat);
			clearTimeout(lifetime);
			this.subscriptions.delete(subscription);
		};
		response.once('close', close);
		response.once('finish', close);
		await check(true);
	}

	async onApplicationShutdown(): Promise<void> {
		this.stopped = true;
		for (const item of this.subscriptions) item.response.end();
		const client = this.client;
		this.client = undefined;
		await client?.end().catch(() => undefined);
	}
}
