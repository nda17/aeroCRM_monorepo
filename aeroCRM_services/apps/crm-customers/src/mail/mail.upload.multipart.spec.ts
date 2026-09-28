import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import { MAIL_LIMITS } from './mail.config';
import { MailController, MailUploadScopeGuard } from './mail.controller';
import { MailService } from './mail.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const mailboxId = '22222222-2222-4222-8222-222222222222';
const contactId = '33333333-3333-4333-8333-333333333333';
const commandId = '44444444-4444-4444-8444-444444444444';
const receipt = { accepted: true, attachmentId: 'synthetic-attachment' };

describe('CRM mail upload multipart parser route', () => {
	let app: NestExpressApplication;
	let origin: string;
	const mail = {
		authority: jest.fn(),
		mailbox: jest.fn(),
		contact: jest.fn(),
		upload: jest.fn()
	};

	beforeAll(async () => {
		const module = await Test.createTestingModule({
			controllers: [MailController],
			providers: [
				{ provide: MailService, useValue: mail },
				MailUploadScopeGuard
			]
		}).compile();
		app = module.createNestApplication<NestExpressApplication>({
			logger: false
		});
		app.setGlobalPrefix('api/v1');
		app.useGlobalPipes(
			new ValidationPipe({
				transform: true,
				whitelist: true,
				forbidNonWhitelisted: true,
				validationError: { target: false, value: false }
			})
		);
		await app.listen(0, '127.0.0.1');
		origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		await app?.close();
	});

	beforeEach(() => {
		mail.authority.mockReset().mockResolvedValue({ customer: { workspaceId } });
		mail.mailbox.mockReset().mockResolvedValue({ id: mailboxId });
		mail.contact.mockReset().mockResolvedValue({ id: contactId });
		mail.upload.mockReset().mockResolvedValue(receipt);
	});

	const form = (
		files = [{ name: 'tiny.pdf', contents: 'x'.repeat(73) }],
		extraFields: Array<[string, string]> = []
	) => {
		const body = new FormData();
		body.append('schemaVersion', '1');
		body.append('workspaceId', workspaceId);
		body.append('commandId', commandId);
		body.append('mailboxId', mailboxId);
		body.append('contactId', contactId);
		for (const [name, value] of extraFields) body.append(name, value);
		for (const file of files)
			body.append(
				'file',
				new Blob([file.contents], { type: 'application/pdf' }),
				file.name
			);
		return body;
	};

	const upload = (body: FormData, contactHeader: string | null = contactId) =>
		fetch(`${origin}/api/v1/crm/customers/mail/attachments`, {
			method: 'POST',
			headers: {
				authorization: 'Bearer multipart-test',
				'idempotency-key': commandId,
				'x-mail-workspace-id': workspaceId,
				'x-mail-mailbox-id': mailboxId,
				...(contactHeader === null ? {} : { 'x-mail-contact-id': contactHeader })
			},
			body
		});

	it('accepts the five DTO fields followed by one small file through the real interceptor', async () => {
		const response = await upload(form());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(receipt);
		expect(mail.authority).toHaveBeenCalledTimes(2);
		expect(mail.mailbox).toHaveBeenCalledWith(
			{ customer: { workspaceId } },
			mailboxId,
			'send'
		);
		expect(mail.contact).toHaveBeenCalledWith(
			{ customer: { workspaceId } },
			contactId
		);
		expect(mail.upload).toHaveBeenCalledTimes(1);
		const [, dto, file] = mail.upload.mock.calls[0];
		expect(dto).toMatchObject({
			schemaVersion: 1,
			workspaceId,
			commandId,
			mailboxId,
			contactId
		});
		expect(file).toMatchObject({
			originalname: 'tiny.pdf',
			mimetype: 'application/pdf',
			size: 73
		});
		expect(file.buffer).toHaveLength(73);
	});

	it('accepts omitted contact in both multipart and header and rejects inconsistent scope', async () => {
    const unbound = form();
    unbound.delete('contactId');
    expect((await upload(unbound, null)).status).toBe(200);
    expect(mail.upload.mock.calls[0][1].contactId).toBeUndefined();
    expect(mail.contact).not.toHaveBeenCalled();
    mail.upload.mockClear();
    expect((await upload(form(), null)).status).toBe(400);
    expect((await upload(unbound)).status).toBe(400);
    expect(mail.upload).not.toHaveBeenCalled();
  });

	it('rejects a sixth text field and a second file before invoking the mail service', async () => {
		const extraField = await upload(form(undefined, [['unexpected', 'value']]));
		expect(extraField.status).toBe(400);
		expect(mail.upload).not.toHaveBeenCalled();

		const tooManyFiles = await upload(
			form([
				{ name: 'first.pdf', contents: 'first' },
				{ name: 'second.pdf', contents: 'second' }
			])
		);
		expect(tooManyFiles.status).toBe(400);
		expect(mail.upload).not.toHaveBeenCalled();
	});

	it('keeps the multipart field and file byte limits active', async () => {
		const oversizedFieldForm = form();
		oversizedFieldForm.set('schemaVersion', 'x'.repeat(1025));
		const fieldTooLarge = await upload(oversizedFieldForm);
		expect(fieldTooLarge.status).toBe(400);
		expect(await fieldTooLarge.json()).toMatchObject({
			message: 'Field value too long - schemaVersion'
		});
		expect(mail.upload).not.toHaveBeenCalled();

		const fileTooLarge = await upload(
			form([
				{
					name: 'too-large.pdf',
					contents: 'x'.repeat(MAIL_LIMITS.maxFileBytes + 1)
				}
			])
		);
		expect(fileTooLarge.status).toBe(413);
		expect(mail.upload).not.toHaveBeenCalled();
	});
});
