import { EmailService } from './email.service';
import nodemailer from 'nodemailer';
import type { SendMailOptions, Transporter } from 'nodemailer';

const RECIPIENT = 'owner@example.com';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const INVITATION_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const CONVERSATION_ID = '55555555-5555-4555-8555-555555555555';
const ENTRY_ID = '66666666-6666-4666-8666-666666666666';

interface EmailCase {
	name: string;
	messageId: string;
	textIncludes: string[];
	send: (service: EmailService) => Promise<unknown>;
}

const cases: EmailCase[] = [
	{
		name: 'campaign broadcast',
		messageId: '<campaign-1@aerocrm.space>',
		textIncludes: [
			'Проверьте тарифный план',
			'https://aerocrm.space/payment',
			'Оповещение от команды aeroCRM'
		],
		send: service =>
			service.sendAdminBroadcast(
				RECIPIENT,
				{
					subject: 'Обновление тарифа',
					message:
						'Проверьте тарифный план: https://aerocrm.space/payment'
				},
				{ messageId: '<campaign-1@aerocrm.space>' }
			)
	},
	{
		name: 'subscription reminder',
		messageId: '<subscription-1@aerocrm.space>',
		textIncludes: [
			'Подписка закончится через 3 дня',
			'Тариф Команда действует до 10 октября 2026 МСК',
			'https://aerocrm.space/payment'
		],
		send: service =>
			service.sendSubscriptionExpiryReminder(
				RECIPIENT,
				{
					daysBeforeExpiry: 3,
					planLabel: 'Команда',
					expiresAtLabel: '10 октября 2026'
				},
				{ messageId: '<subscription-1@aerocrm.space>' }
			)
	},
	{
		name: 'invitation',
		messageId: `<${EVENT_ID}.crm-invitation@aerocrm.space>`,
		textIncludes: [
			'Вас пригласили в команду aeroCRM',
			'Действует до 10.10.2026, 21:00:00',
			`https://workspace.aerocrm.space/invitations/${INVITATION_ID}#email=owner%40example.com`
		],
		send: service =>
			service.sendCrmInvitation(
				RECIPIENT,
				INVITATION_ID,
				'2026-10-10T18:00:00.000Z',
				EVENT_ID
			)
	},
	{
		name: 'task reminder',
		messageId: `<${EVENT_ID}.crm-task-reminder@aerocrm.space>`,
		textIncludes: [
			'Подготовить смету',
			'Срок: 10.10.2026',
			`https://workspace.aerocrm.space/planner?task=${TASK_ID}`
		],
		send: service =>
			service.sendCrmTaskReminder(
				RECIPIENT,
				{
					taskId: TASK_ID,
					title: 'Подготовить смету',
					dueAt: '2026-10-10T12:00:00.000Z',
					timeZone: 'Europe/Moscow'
				},
				EVENT_ID
			)
	},
	{
		name: 'support notification',
		messageId: `<${EVENT_ID}.support-notification@aerocrm.space>`,
		textIncludes: [
			'Ответ оператора уже доступен',
			'Обращение №42',
			`https://workspace.aerocrm.space/inbox?supportConversation=${CONVERSATION_ID}`
		],
		send: service =>
			service.sendSupportNotification(
				RECIPIENT,
				{
					conversationId: CONVERSATION_ID,
					conversationNumber: 42,
					notificationType: 'OPERATOR_REPLY'
				},
				true,
				EVENT_ID
			)
	},
	{
		name: 'Intake SLA notification',
		messageId: `<${EVENT_ID}.crm-intake-sla@aerocrm.space>`,
		textIncludes: [
			'Обращение без ответа',
			'Запрос по подключению',
			'Срок взятия в работу:',
			`https://workspace.aerocrm.space/inbox?entry=${ENTRY_ID}`
		],
		send: service =>
			service.sendCrmIntakeSla(
				RECIPIENT,
				{
					entryId: ENTRY_ID,
					title: 'Запрос по подключению',
					dueAt: '2026-10-10T12:00:00.000Z',
					timeZone: 'Europe/Moscow'
				},
				EVENT_ID
			)
	}
];

describe('EmailService', () => {
	it.each(cases)('$name includes a readable text alternative and sends once', async testCase => {
		const sendMail = jest.fn(async (message: SendMailOptions) => ({ message }));
		const service = new EmailService({ sendMail } as unknown as Transporter);

		await testCase.send(service);

		expect(sendMail).toHaveBeenCalledTimes(1);
		const [message] = sendMail.mock.calls[0];
		expect(message.to).toBe(RECIPIENT);
		expect(message.messageId).toBe(testCase.messageId);
		expect(typeof message.text).toBe('string');
		const plainText = message.text as string;
		expect(plainText.trim().length).toBeGreaterThan(0);
		for (const expectedText of testCase.textIncludes) {
			expect(plainText).toContain(expectedText);
		}
		expect(plainText).not.toMatch(/<\/?[a-z][^>]*>/i);
		expect(plainText).not.toContain('cid:');
	});

	it('produces one multipart MIME message with text, HTML, and the inline logo offline', async () => {
		const mailer = nodemailer.createTransport({
			streamTransport: true,
			buffer: true,
			newline: 'unix'
		});
		const sendMail = jest.spyOn(mailer, 'sendMail');
		const service = new EmailService(mailer);

		try {
			const result = await service.sendCrmInvitation(
				RECIPIENT,
				INVITATION_ID,
				'2026-10-10T18:00:00.000Z',
				EVENT_ID
			);
			const info = result as { message: Buffer; messageId: string };
			const rawMime = info.message.toString('utf8');
			const unfoldedMime = rawMime.replace(/\n[ \t]+/g, ' ');
			expect(sendMail).toHaveBeenCalledTimes(1);
			expect(info.messageId).toBe(
				`<${EVENT_ID}.crm-invitation@aerocrm.space>`
			);
			expect(unfoldedMime).toContain(`Message-ID: ${info.messageId}`);
			expect(unfoldedMime).toMatch(/Content-Type: multipart\/alternative;/i);
			expect(unfoldedMime).toMatch(/Content-Type: multipart\/related;/i);
			expect(unfoldedMime).toMatch(/Content-Type: text\/plain; charset=utf-8/i);
			expect(unfoldedMime).toMatch(/Content-Type: text\/html; charset=utf-8/i);
			expect(unfoldedMime).toMatch(/Content-ID: <aerocrm-notification-logo>/i);
			expect(unfoldedMime).toMatch(/Content-Disposition: inline; filename=aerocrm-logo\.png/i);
			expect(unfoldedMime).toContain('cid:aerocrm-notification-logo');

			const textPartStart = rawMime.indexOf(
				'Content-Type: text/plain; charset=utf-8'
			);
			const textHeadersEnd = rawMime.indexOf('\n\n', textPartStart);
			const textPartEnd = rawMime.indexOf('\n--', textHeadersEnd);
			const encodedText = rawMime
				.slice(textHeadersEnd + 2, textPartEnd)
				.trim();
			const plainText = Buffer.from(encodedText, 'base64').toString('utf8');
			expect(plainText).toContain('Вас пригласили в команду aeroCRM');
			expect(plainText).toContain(
				`https://workspace.aerocrm.space/invitations/${INVITATION_ID}#email=owner%40example.com`
			);
			expect(plainText).not.toMatch(/<\/?[a-z][^>]*>/i);
			expect(plainText).not.toContain('cid:');
		} finally {
			sendMail.mockRestore();
			mailer.close();
		}
	});
});
