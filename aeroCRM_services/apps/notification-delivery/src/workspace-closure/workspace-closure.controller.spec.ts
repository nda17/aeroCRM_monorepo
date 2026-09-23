import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import {
	WorkspaceClosureController,
	WorkspaceClosureInternalGuard,
	WorkspaceClosureService
} from './workspace-closure.controller';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const closureId = '22222222-2222-4222-8222-222222222222';
const binding = {
	schemaVersion: 1,
	closureId,
	workspaceId,
	generation: '1',
	ownerSubject: 'owner-1',
	requestedAt: '2026-09-23T12:00:00.000Z'
};
const acknowledgement = {
	schemaVersion: 1,
	service: 'notification-delivery',
	closureId,
	workspaceId,
	generation: '1',
	state: 'FENCED',
	fencedAt: '2026-09-23T12:00:01.000Z',
	financialPendingCount: 0,
	priorDispatchCount: 0
};

describe('Notification Delivery workspace closure HTTP contract', () => {
	let app: NestExpressApplication;
	let origin: string;
	const fence = jest.fn();

	beforeAll(async () => {
		const module = await Test.createTestingModule({
			controllers: [WorkspaceClosureController],
			providers: [{ provide: WorkspaceClosureService, useValue: { fence } }]
		})
			.overrideGuard(WorkspaceClosureInternalGuard)
			.useValue({ canActivate: () => true })
			.compile();
		app = module.createNestApplication<NestExpressApplication>({ logger: false });
		await app.listen(0, '127.0.0.1');
		origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		await app?.close();
	});

	beforeEach(() => {
		fence.mockReset().mockResolvedValue(acknowledgement);
	});

	it('returns a bound 200 no-store ACK on the internal route', async () => {
		const response = await fetch(`${origin}/internal/v1/workspace-closures/fence`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(binding)
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual(acknowledgement);
		expect(fence).toHaveBeenCalledWith(binding);
	});
});
