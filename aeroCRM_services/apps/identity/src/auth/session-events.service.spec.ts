import { EventEmitter } from 'node:events';
import { ServiceUnavailableException } from '@nestjs/common';
import { UserStatus } from '@prisma/identity-client';
import type { Response } from 'express';
import { IdentityPrismaService } from '../prisma/identity-prisma.service';
import { SessionEventsService } from './session-events.service';

jest.mock('pg', () => {
	const clients: FakeClient[] = [];
	class FakeClient extends EventEmitter {
		connect = jest.fn().mockResolvedValue(undefined);
		query = jest.fn().mockResolvedValue({});
		end = jest.fn().mockResolvedValue(undefined);
	}
	return {
		Client: jest.fn(() => {
			const client = new FakeClient();
			clients.push(client);
			return client;
		}),
		clients
	};
});

const pgMock = jest.requireMock('pg') as {
	clients: Array<
		EventEmitter & {
			connect: jest.Mock;
			query: jest.Mock;
			end: jest.Mock;
		}
	>;
};
const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const CHANNEL = 'identity_session_revoked_v1';

function activeSession() {
	return {
		id: SESSION_ID,
		userId: USER_ID,
		revokedAt: null,
		expiresAt: new Date(Date.now() + 60_000),
		user: { status: UserStatus.ACTIVE, deletedAt: null }
	};
}

function response(writeValue = true) {
	const emitter = new EventEmitter();
	const value = Object.assign(emitter, {
		destroyed: false,
		status: jest.fn(function (this: unknown) {
			return this;
		}),
		set: jest.fn(function (this: unknown) {
			return this;
		}),
		flushHeaders: jest.fn(),
		write: jest.fn().mockReturnValue(writeValue),
		end: jest.fn(() => emitter.emit('finish'))
	});
	return value as unknown as Response & {
		write: jest.Mock;
		end: jest.Mock;
		set: jest.Mock;
	};
}

describe('SessionEventsService', () => {
	const previousDatabaseUrl = process.env.IDENTITY_DATABASE_URL;
	let prisma: { userSession: { findFirst: jest.Mock } };
	let service: SessionEventsService;

	beforeEach(() => {
		jest.useRealTimers();
		process.env.IDENTITY_DATABASE_URL = 'postgresql://identity.test/db';
		pgMock.clients.length = 0;
		prisma = {
			userSession: {
				findFirst: jest.fn().mockResolvedValue(activeSession())
			}
		};
		service = new SessionEventsService(
			prisma as unknown as IdentityPrismaService
		);
	});
	afterEach(async () => {
		await service.onApplicationShutdown();
		jest.useRealTimers();
		if (previousDatabaseUrl === undefined)
			delete process.env.IDENTITY_DATABASE_URL;
		else process.env.IDENTITY_DATABASE_URL = previousDatabaseUrl;
	});

	it('subscribes before the initial session read so a concurrent revoke cannot be missed', async () => {
		let resolveSession!: (value: ReturnType<typeof activeSession>) => void;
		prisma.userSession.findFirst.mockReturnValue(
			new Promise(resolve => {
				resolveSession = resolve;
			})
		);
		const responseStream = response();
		const opening = service.open(
			SESSION_ID,
			USER_ID,
			Date.now() + 30_000,
			responseStream
		);
		for (
			let index = 0;
			index < 8 && !prisma.userSession.findFirst.mock.calls.length;
			index++
		)
			await Promise.resolve();
		expect(prisma.userSession.findFirst).toHaveBeenCalledWith({
			where: { id: SESSION_ID, userId: USER_ID },
			include: { user: true }
		});
		pgMock.clients[0].emit('notification', {
			channel: CHANNEL,
			payload: SESSION_ID
		});
		resolveSession(activeSession());
		await opening;
		expect(responseStream.write).toHaveBeenCalledWith(
			'event: revoked\ndata: {}\n\n'
		);
		expect(responseStream.write).not.toHaveBeenCalledWith(
			'event: ready\ndata: {}\n\n'
		);
		expect(responseStream.end).toHaveBeenCalled();
	});

	it('writes a ready event and ends the stream when PostgreSQL revokes that session', async () => {
		const responseStream = response();
		await service.open(
			SESSION_ID,
			USER_ID,
			Date.now() + 30_000,
			responseStream
		);
		expect(responseStream.status).toHaveBeenCalledWith(200);
		expect(responseStream.set).toHaveBeenCalledWith(
			expect.objectContaining({
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-store, no-transform',
				'X-Accel-Buffering': 'no'
			})
		);
		expect(responseStream.write).toHaveBeenCalledWith(
			'event: ready\ndata: {}\n\n'
		);
		pgMock.clients[0].emit('notification', {
			channel: CHANNEL,
			payload: SESSION_ID
		});
		expect(responseStream.write).toHaveBeenCalledWith(
			'event: revoked\ndata: {}\n\n'
		);
		expect(responseStream.end).toHaveBeenCalled();
	});

	it('ends a slow client when an SSE write reports backpressure', async () => {
		const responseStream = response(false);
		await service.open(
			SESSION_ID,
			USER_ID,
			Date.now() + 30_000,
			responseStream
		);
		expect(responseStream.write).toHaveBeenCalledTimes(1);
		expect(responseStream.end).toHaveBeenCalledTimes(1);
		pgMock.clients[0].emit('notification', {
			channel: CHANNEL,
			payload: SESSION_ID
		});
		expect(responseStream.write).toHaveBeenCalledTimes(1);
	});

	it('closes the stream at access-token expiry without declaring the session revoked', async () => {
		jest.useFakeTimers().setSystemTime(
			new Date('2026-10-04T12:00:00.000Z')
		);
		prisma.userSession.findFirst.mockResolvedValue({
			...activeSession(),
			expiresAt: new Date('2026-10-04T12:10:00.000Z')
		});
		const responseStream = response();
		await service.open(
			SESSION_ID,
			USER_ID,
			Date.now() + 100,
			responseStream
		);
		await jest.advanceTimersByTimeAsync(100);
		expect(responseStream.end).toHaveBeenCalled();
		expect(responseStream.write).toHaveBeenCalledTimes(1);
	});

	it('closes active streams if the dedicated PostgreSQL listener is lost', async () => {
		const responseStream = response();
		await service.open(
			SESSION_ID,
			USER_ID,
			Date.now() + 30_000,
			responseStream
		);
		pgMock.clients[0].emit('error', new Error('listener disconnected'));
		expect(responseStream.end).toHaveBeenCalled();
		expect(responseStream.write).toHaveBeenCalledTimes(1);
	});

	it('fails closed when the listener cannot subscribe', async () => {
		pgMock.clients.length = 0;
		const unavailable = new SessionEventsService(
			prisma as unknown as IdentityPrismaService
		);
		// A failed LISTEN is distinct from an HTTP event stream that never started.
		const stream = response();
		const opening = unavailable.open(
			SESSION_ID,
			USER_ID,
			Date.now() + 30_000,
			stream
		);
		const client = pgMock.clients.at(-1);
		client?.query.mockRejectedValue(new Error('LISTEN denied'));
		await expect(opening).rejects.toBeInstanceOf(
			ServiceUnavailableException
		);
		expect(stream.status).not.toHaveBeenCalled();
		await unavailable.onApplicationShutdown();
	});
});
