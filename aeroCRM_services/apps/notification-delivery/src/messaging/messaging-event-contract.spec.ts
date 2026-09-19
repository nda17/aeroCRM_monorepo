import { assertMessagingEventContract } from './messaging-event-contract';
import { parseNotificationDeliveryMessage } from '../notification-delivery/notification-delivery-contract';
import type { ConsumeMessage } from 'amqplib';
import type { NotificationDeliveryKind } from './messaging.constants';

describe('notification delivery messaging contracts', () => {
	const messageId = '11111111-1111-4111-8111-111111111111';
	it('accepts only a private Operations backup report console button', () => {
		const eventType = 'notification.operations.backup-report.telegram.requested.v1';
		const payload = {
			schemaVersion: 1, eventType, eventId: messageId,
			occurredAt: '2026-09-20T10:00:00.000Z',
			reference: { type: 'operations-backup-report', id: messageId },
			destination: { telegramChatId: '-1001234567890', messageThreadId: 42 },
			content: { text: '12/12 backups', consoleUrl: 'https://console.example.invalid/private-bucket' }
		};
		const metadata = { eventType, routingKey: eventType, messageId,
			kind: 'operations-backup-report-telegram' as const };
		expect(() => assertMessagingEventContract(payload, metadata)).not.toThrow();
		expect(() => assertMessagingEventContract({ ...payload,
			content: { ...payload.content, consoleUrl: 'http://example.invalid/public' }
		}, metadata)).toThrow();
		expect(() => assertMessagingEventContract({ ...payload,
			eventId: '22222222-2222-4222-8222-222222222222'
		}, metadata)).toThrow();
		const message = {
			properties: { type: eventType, messageId, headers: {} },
			fields: { routingKey: eventType },
			content: Buffer.from(JSON.stringify(payload))
		} as ConsumeMessage;
		expect(() => parseNotificationDeliveryMessage(metadata.kind, message)).toThrow('source is invalid');
		message.properties.headers!['x-aerocrm-service'] = 'operations';
		expect(() => parseNotificationDeliveryMessage(metadata.kind, message)).not.toThrow();
	});
	it.each([
		[
			'campaign-email',
			'notification.campaign.email.requested.v2',
			{
				destination: { email: 'owner@example.com' }
			}
		],
		[
			'campaign-telegram',
			'notification.campaign.telegram.requested.v2',
			{
				destination: { telegramChatId: '12345' }
			}
		]
	])('accepts the strict %s request contract', (kind, eventType, data) => {
		const campaignId = '33333333-3333-4333-8333-333333333333';
		const deliveryId = '22222222-2222-4222-8222-222222222222';
		expect(() =>
			assertMessagingEventContract(
				{
					schemaVersion: 2,
					eventType,
					eventId: messageId,
					occurredAt: '2026-07-30T10:00:00.000Z',
					correlationId: '44444444-4444-4444-8444-444444444444',
					campaignId,
					deliveryId,
					dispatchGeneration: 2,
					reference: {
						type: 'campaign-delivery',
						id: deliveryId,
						aggregateId: campaignId,
						dispatchGeneration: 2
					},
					...data,
					content: { subject: 'Новости', message: 'Текст' }
				},
				{
					eventType,
					routingKey: eventType,
					messageId,
					kind: kind as NotificationDeliveryKind
				}
			)
		).not.toThrow();
	});

	it.each([
		[
			'daily-summary-delivery-telegram',
			'notification.daily-summary.telegram.requested.v1',
			{
				reference: {
					type: 'daily-summary-job',
					id: '22222222-2222-4222-8222-222222222222'
				},
				destination: {
					telegramChatId: '-100123',
					messageThreadId: 42
				},
				content: { text: '<b>Итоги</b>' }
			}
		],
		[
			'subscription-expiry-email',
			'notification.subscription-expiry.email.requested.v1',
			{
				reference: {
					type: 'subscription-expiry-reminder',
					id: '22222222-2222-4222-8222-222222222222'
				},
				destination: { email: 'owner@example.com' },
				content: {
					daysBeforeExpiry: 3,
					planLabel: 'Easy',
					expiresAtLabel: '31.07.2026, 12:00'
				}
			}
		],
		[
			'subscription-expiry-telegram',
			'notification.subscription-expiry.telegram.requested.v1',
			{
				reference: {
					type: 'subscription-expiry-reminder',
					id: '22222222-2222-4222-8222-222222222222'
				},
				destination: { telegramChatId: '12345' },
				content: {
					daysBeforeExpiry: 3,
					planLabel: 'Easy',
					expiresAtLabel: '31.07.2026, 12:00'
				}
			}
		]
	])('accepts the strict %s request contract', (kind, eventType, data) => {
		expect(() =>
			assertMessagingEventContract(
				{
					schemaVersion: 1,
					eventType,
					...data
				},
				{
					eventType,
					routingKey: eventType,
					messageId,
					kind: kind as NotificationDeliveryKind
				}
			)
		).not.toThrow();
	});

	it('separates Core and Reporting delivery outcome routes', () => {
		const corePayload = {
			schemaVersion: 1,
			eventType: 'notification.delivery.outcome.v1',
			sourceEventId: messageId,
			sourceKind: 'subscription-expiry-email',
			reference: {
				type: 'subscription-expiry-reminder',
				id: 'subscription-reminder-1'
			},
			status: 'DELIVERED',
			failure: null,
			occurredAt: '2026-08-04T00:00:00.000Z'
		};
		const reportingPayload = {
			schemaVersion: 1,
			eventType: 'reporting.notification.delivery.outcome.v1',
			sourceEventId: messageId,
			sourceKind: 'daily-summary-delivery-telegram',
			reference: { type: 'daily-summary-job', id: messageId },
			status: 'DELIVERED',
			failure: null,
			occurredAt: '2026-08-04T00:00:00.000Z'
		};

		expect(() =>
			assertMessagingEventContract(corePayload, {
				eventType: corePayload.eventType,
				routingKey: corePayload.eventType,
				messageId: '22222222-2222-4222-8222-222222222222'
			})
		).not.toThrow();
		expect(() =>
			assertMessagingEventContract(reportingPayload, {
				eventType: reportingPayload.eventType,
				routingKey: reportingPayload.eventType,
				messageId: '22222222-2222-4222-8222-222222222222'
			})
		).not.toThrow();
		expect(() =>
			assertMessagingEventContract(
				{
					...corePayload,
					sourceKind: 'daily-summary-delivery-telegram',
					reference: { type: 'daily-summary-job', id: messageId }
				},
				{
					eventType: corePayload.eventType,
					routingKey: corePayload.eventType,
					messageId: '22222222-2222-4222-8222-222222222222'
				}
			)
		).toThrow('payload.sourceKind is invalid');
		expect(() =>
			assertMessagingEventContract(reportingPayload, {
				eventType: reportingPayload.eventType,
				routingKey: 'notification.delivery.outcome.v1',
				messageId: '22222222-2222-4222-8222-222222222222'
			})
		).toThrow();
	});

	it('accepts only the exact outbound campaign delivery outcome route', () => {
		const payload = {
			schemaVersion: 2,
			eventType: 'notification.delivery.outcome.v2',
			eventId: messageId,
			occurredAt: '2026-07-28T10:00:00.000Z',
			correlationId: '44444444-4444-4444-8444-444444444444',
			sourceEventId: messageId,
			sourceKind: 'campaign-email',
			campaignId: '33333333-3333-4333-8333-333333333333',
			deliveryId: '22222222-2222-4222-8222-222222222222',
			dispatchGeneration: 2,
			status: 'DELIVERED',
			failure: null
		};

		expect(() =>
			assertMessagingEventContract(payload, {
				eventType: payload.eventType,
				routingKey: payload.eventType,
				messageId
			})
		).not.toThrow();
		expect(() =>
			assertMessagingEventContract(payload, {
				eventType: payload.eventType,
				routingKey: 'manual.campaign-email',
				messageId
			})
		).toThrow();
	});

	it('accepts only the exact outbound destination-unavailable route', () => {
		const payload = {
			schemaVersion: 1,
			eventType: 'notification.telegram.destination-unavailable.v1',
			sourceEventId: messageId,
			sourceKind: 'campaign-telegram',
			destination: { telegramChatId: '12345' },
			normalizedCode: 'TELEGRAM_CHAT_NOT_FOUND',
			occurredAt: '2026-07-28T10:00:00.000Z'
		};

		expect(() =>
			assertMessagingEventContract(payload, {
				eventType: payload.eventType,
				routingKey: payload.eventType,
				messageId: '22222222-2222-4222-8222-222222222222'
			})
		).not.toThrow();
		expect(() =>
			assertMessagingEventContract(payload, {
				eventType: payload.eventType,
				routingKey: 'manual.campaign-telegram',
				messageId: '22222222-2222-4222-8222-222222222222'
			})
		).toThrow();
		expect(() =>
			assertMessagingEventContract(
				{ ...payload, sourceKind: 'payment-telegram' },
				{
					eventType: payload.eventType,
					routingKey: payload.eventType,
					messageId: '22222222-2222-4222-8222-222222222222'
				}
			)
		).toThrow();
	});

});
