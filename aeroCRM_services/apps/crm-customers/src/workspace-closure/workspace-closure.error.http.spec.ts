import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import { Prisma } from '@prisma/crm-customers-client';
import {
	CustomersAuthorizationClient,
	type CustomersAuthorization
} from '../access/customers-authorization.client';
import { ContactsV2Controller } from '../customers/contacts-v2.controller';
import { CustomersService } from '../customers/customers.service';
import { CrmCustomersPrismaService } from '../prisma/crm-customers-prisma.service';
import { WorkspaceClosureErrorFilter } from './workspace-closure.controller';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const actor: CustomersAuthorization = {
	schemaVersion: 1,
	workspaceId,
	subject: 'owner-1',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['customers:read', 'customers:write']
};

describe('CRM Customers closed-workspace Prisma HTTP contract', () => {
	let app: NestExpressApplication;
	let origin: string;
	const authorize = jest.fn();
	const contactCreate = jest.fn();
	const rawAssert = jest.fn();
	const tx = {
		$executeRaw: rawAssert,
		$queryRaw: jest.fn().mockResolvedValue([]),
		customerCommand: {
			findUnique: jest.fn().mockResolvedValue(null),
			create: jest.fn()
		},
		contact: { create: contactCreate, updateMany: jest.fn(), count: jest.fn() },
		company: { create: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
		customerActivity: { create: jest.fn() },
	};
	const prisma = {
		$transaction: jest.fn((operation: (client: typeof tx) => Promise<unknown>) =>
			operation(tx)
		)
	};

	beforeAll(async () => {
		const module = await Test.createTestingModule({
			controllers: [ContactsV2Controller],
			providers: [
				{ provide: CustomersAuthorizationClient, useValue: { authorize } },
				CustomersService,
				{ provide: CrmCustomersPrismaService, useValue: prisma }
			]
		}).compile();
		app = module.createNestApplication<NestExpressApplication>({ logger: false });
		app.setGlobalPrefix('api/v1');
		app.useGlobalPipes(
			new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
		);
		app.useGlobalFilters(new WorkspaceClosureErrorFilter(app.get(HttpAdapterHost)));
		await app.listen(0, '127.0.0.1');
		origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		await app?.close();
	});

	beforeEach(() => {
		authorize.mockReset().mockResolvedValue(actor);
		prisma.$transaction.mockClear();
		rawAssert.mockReset().mockResolvedValue(1);
		tx.customerCommand.findUnique.mockReset().mockResolvedValue(null);
		tx.customerCommand.create.mockClear();
		tx.customerActivity.create.mockClear();
		contactCreate.mockReset().mockImplementation(async () => ({
			id: '33333333-3333-4333-8333-333333333333',
			workspaceId,
			name: 'Closed contact',
			phone: null,
			email: null,
			companyId: null,
			notes: null,
			teamId: null,
			version: 1,
			createdAt: new Date('2026-09-23T12:00:00.000Z'),
			updatedAt: new Date('2026-09-23T12:00:00.000Z'),
			archivedAt: null
		}));
	});

	const request = () =>
		fetch(`${origin}/api/v1/crm/customers/v2/contacts`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer test',
				'idempotency-key': commandId
			},
			body: JSON.stringify({ schemaVersion: 2, workspaceId, commandId, name: 'Closed contact' })
		});

	const expectClosed = async (response: Response) => {
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			code: 'crm_workspace_closed',
			message: 'Workspace is closed'
		});
		expect(authorize).toHaveBeenCalledWith('Bearer test', workspaceId);
	};

	it('maps a Prisma-wrapped raw assert SQL refusal to stable HTTP 403', async () => {
		rawAssert
			.mockResolvedValueOnce(1)
			.mockRejectedValueOnce(
				new Prisma.PrismaClientKnownRequestError(
					'Raw query failed. Code: `P0001`. Message: `crm_workspace_closed`',
					{ code: 'P2010', clientVersion: 'test', meta: { code: 'P0001', message: 'crm_workspace_closed' } }
				)
			);

		const response = await request();
		await expectClosed(response);
		expect(rawAssert).toHaveBeenCalledTimes(2);
		expect(contactCreate).not.toHaveBeenCalled();
	});

	it('maps a Prisma-wrapped business model mutation refusal to stable HTTP 403', async () => {
		contactCreate.mockRejectedValue(
			new Prisma.PrismaClientKnownRequestError(
				'Constraint failed: crm_workspace_closed',
				{ code: 'P2004', clientVersion: 'test', meta: { database_error: 'crm_workspace_closed' } }
			)
		);

		const response = await request();
		await expectClosed(response);
		expect(rawAssert).toHaveBeenCalledTimes(3);
		expect(contactCreate).toHaveBeenCalledTimes(1);
	});
});
