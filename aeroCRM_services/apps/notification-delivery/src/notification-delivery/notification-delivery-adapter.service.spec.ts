import { NotificationDeliveryAdapterService } from './notification-delivery-adapter.service';
import { EmailService } from '../email/email.service';
import type { NotificationDeliveryPrismaService } from './prisma/notification-delivery-prisma.service';
import type { TelegramInfoTransportService } from '../telegram/telegram-info-transport.service';
import { render } from '@react-email/render';
import type { Transporter } from 'nodemailer';
import type { WincrmInvitationContextService } from './wincrm-invitation-context.service';
import type { WincrmTaskReminderContextService } from './wincrm-task-reminder-context.service';

describe('NotificationDeliveryAdapterService', () => {
	const email = {
		sendAdminBroadcast: jest.fn().mockResolvedValue(undefined),
		sendSubscriptionExpiryReminder: jest.fn().mockResolvedValue(undefined)
	} as unknown as EmailService;
	const telegram = {
		sendMessage: jest.fn().mockResolvedValue(undefined)
	} as unknown as TelegramInfoTransportService;
	const prisma = {} as NotificationDeliveryPrismaService;
	const invitationContext = {} as WincrmInvitationContextService;
	const service = new NotificationDeliveryAdapterService(
		email,
		telegram,
		prisma,
		invitationContext,
		{} as WincrmTaskReminderContextService
	);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('delivers a prepared campaign email with a stable provider id', async () => {
		await service.deliver(
			'campaign-email',
			{
				schemaVersion: 2,
				eventType: 'notification.campaign.email.requested.v2',
				eventId: '11111111-1111-4111-8111-111111111111',
				occurredAt: '2026-07-30T10:00:00.000Z',
				correlationId: '44444444-4444-4444-8444-444444444444',
				campaignId: '33333333-3333-4333-8333-333333333333',
				deliveryId: '22222222-2222-4222-8222-222222222222',
				dispatchGeneration: 1,
				reference: {
					type: 'campaign-delivery',
					id: '22222222-2222-4222-8222-222222222222',
					aggregateId: '33333333-3333-4333-8333-333333333333',
					dispatchGeneration: 1
				},
				destination: { email: 'owner@example.com' },
				content: {
					subject: 'Новости',
					message: 'Текст рассылки'
				}
			},
			'11111111-1111-4111-8111-111111111111'
		);

		expect(email.sendAdminBroadcast).toHaveBeenCalledWith(
			'owner@example.com',
			{
				subject: 'Новости',
				message: 'Текст рассылки'
			},
			{
				messageId:
					'<11111111-1111-4111-8111-111111111111.campaign@aerocrm.space>'
			}
		);
	});

	it('resumes a chunked campaign Telegram delivery from its service checkpoint', async () => {
		const checkpointPrisma = {
			notificationDeliveryReceipt: {
				findFirst: jest.fn().mockResolvedValue({
					checkpoint: { nextChunkIndex: 1 }
				}),
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			}
		} as unknown as NotificationDeliveryPrismaService;
		const checkpointService = new NotificationDeliveryAdapterService(
			email,
			telegram,
			checkpointPrisma,
			invitationContext,
			{} as WincrmTaskReminderContextService
		);

		await checkpointService.deliver(
			'campaign-telegram',
			{
				schemaVersion: 2,
				eventType: 'notification.campaign.telegram.requested.v2',
				eventId: '11111111-1111-4111-8111-111111111111',
				occurredAt: '2026-07-30T10:00:00.000Z',
				correlationId: '44444444-4444-4444-8444-444444444444',
				campaignId: '33333333-3333-4333-8333-333333333333',
				deliveryId: '22222222-2222-4222-8222-222222222222',
				dispatchGeneration: 1,
				reference: {
					type: 'campaign-delivery',
					id: '22222222-2222-4222-8222-222222222222',
					aggregateId: '33333333-3333-4333-8333-333333333333',
					dispatchGeneration: 1
				},
				destination: { telegramChatId: '12345' },
				content: {
					subject: 'Новости',
					message: 'a'.repeat(3601)
				}
			},
			'11111111-1111-4111-8111-111111111111',
			'44444444-4444-4444-8444-444444444444'
		);

		expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
		expect(telegram.sendMessage).toHaveBeenCalledWith(
			'12345',
			'a'.repeat(101),
			{ parseMode: null }
		);
		expect(
			checkpointPrisma.notificationDeliveryReceipt.updateMany
		).toHaveBeenCalledWith({
			where: {
				eventId: '11111111-1111-4111-8111-111111111111',
				consumer: 'campaign-telegram',
				status: 'PROCESSING',
				lockToken: '44444444-4444-4444-8444-444444444444'
			},
			data: {
				checkpoint: { nextChunkIndex: 2 }
			}
		});
	});

	it('delivers daily summary and subscription expiry Telegram events', async () => {
		await service.deliver(
			'daily-summary-delivery-telegram',
			{
				schemaVersion: 1,
				eventType: 'notification.daily-summary.telegram.requested.v1',
				reference: {
					type: 'daily-summary-job',
					id: '22222222-2222-4222-8222-222222222222'
				},
				destination: {
					telegramChatId: '-100123',
					messageThreadId: 42
				},
				content: { text: '<b>Итоги дня</b>' }
			},
			'11111111-1111-4111-8111-111111111111'
		);
		await service.deliver(
			'subscription-expiry-telegram',
			{
				schemaVersion: 1,
				eventType:
					'notification.subscription-expiry.telegram.requested.v1',
				reference: {
					type: 'subscription-expiry-reminder',
					id: '33333333-3333-4333-8333-333333333333'
				},
				destination: { telegramChatId: '12345' },
				content: {
					daysBeforeExpiry: 3,
					planLabel: 'Easy <test>',
					expiresAtLabel: '31.07.2026, 12:00'
				}
			},
			'55555555-5555-4555-8555-555555555555'
		);

		expect(telegram.sendMessage).toHaveBeenNthCalledWith(
			1,
			'-100123',
			'<b>Итоги дня</b>',
			{ messageThreadId: 42, parseMode: 'HTML' }
		);
		expect(telegram.sendMessage).toHaveBeenNthCalledWith(
			2,
			'12345',
			expect.stringContaining('Easy &lt;test&gt;'),
			{ parseMode: 'HTML' }
		);
	});

	it('delivers a subscription expiry email through the service template', async () => {
		await service.deliver(
			'subscription-expiry-email',
			{
				schemaVersion: 1,
				eventType: 'notification.subscription-expiry.email.requested.v1',
				reference: {
					type: 'subscription-expiry-reminder',
					id: '33333333-3333-4333-8333-333333333333'
				},
				destination: { email: 'owner@example.com' },
				content: {
					daysBeforeExpiry: 3,
					planLabel: 'Easy',
					expiresAtLabel: '31.07.2026, 12:00'
				}
			},
			'11111111-1111-4111-8111-111111111111'
		);

		expect(email.sendSubscriptionExpiryReminder).toHaveBeenCalledWith(
			'owner@example.com',
			{
				daysBeforeExpiry: 3,
				planLabel: 'Easy',
				expiresAtLabel: '31.07.2026, 12:00'
			},
			{
				messageId:
					'<11111111-1111-4111-8111-111111111111.subscription-expiry@aerocrm.space>'
			}
		);
	});
});
