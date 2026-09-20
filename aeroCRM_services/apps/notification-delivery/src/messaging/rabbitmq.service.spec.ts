import type { ConfigService } from '@nestjs/config';
import { RabbitMqService } from './rabbitmq.service';

describe('RabbitMqService invitation topology opt-in', () => {
	it.each([
		undefined,
		'campaign-email',
		'crm-task-reminder-email',
		'crm-task-reminder-telegram'
	])(
		'adds reminder topology only for its opted-in channel %s',
		async configuredKinds => {
			const service = new RabbitMqService({
				get: (key: string) =>
					key === 'NOTIFICATION_DELIVERY_KINDS'
						? configuredKinds
						: undefined
			} as ConfigService);
			const channel = {
				assertExchange: jest.fn(),
				assertQueue: jest.fn(),
				bindQueue: jest.fn()
			};
			await (
				service as unknown as {
					assertTopology(channel: unknown): Promise<void>;
				}
			).assertTopology(channel);
			const queues = channel.assertQueue.mock.calls.map(
				call => call[0] as string
			);
			for (const suffix of ['campaign-email', 'telegram'])
				expect(
					queues.includes(
						`aerocrm.notification.crm.task-reminder.${suffix}`
					)
				).toBe(configuredKinds === `crm-task-reminder-${suffix}`);
		}
	);
	it.each([undefined, 'campaign-email', 'campaign-email,crm-invitation-email'])(
		'asserts invitation queues only for explicit opt-in %s',
		async configuredKinds => {
			const service = new RabbitMqService({
				get: (key: string) =>
					key === 'NOTIFICATION_DELIVERY_KINDS'
						? configuredKinds
						: undefined
			} as ConfigService);
			const channel = {
				assertExchange: jest.fn(),
				assertQueue: jest.fn(),
				bindQueue: jest.fn()
			};
			await (
				service as unknown as {
					assertTopology(channel: unknown): Promise<void>;
				}
			).assertTopology(channel);
			const queues = channel.assertQueue.mock.calls.map(
				call => call[0] as string
			);
			expect(queues).toContain('aerocrm.notification.campaign.email.v2');
			const invitationQueues = queues.filter(queue =>
				queue.startsWith('aerocrm.notification.crm.invitation.email')
			);
			if (configuredKinds?.includes('crm-invitation-email')) {
				expect(invitationQueues).toContain(
					'aerocrm.notification.crm.invitation.email'
				);
				expect(invitationQueues).toContain(
					'aerocrm.notification.crm.invitation.email.dead-letter'
				);
				expect(
					invitationQueues.some(queue => queue.includes('.retry-v2.'))
				).toBe(true);
			} else expect(invitationQueues).toEqual([]);
		}
	);
});
