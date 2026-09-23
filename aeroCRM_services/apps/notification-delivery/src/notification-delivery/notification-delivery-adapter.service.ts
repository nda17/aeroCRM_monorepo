import {
	assertSupportNotificationEvent,
	SupportNotificationSkipReason,
	supportConversationUrl
} from '../messaging/support-notification.contract';
import { SUPPORT_NOTIFICATION_EVENT_TYPES } from '../messaging/messaging.constants';
import { SupportNotificationContextService } from './support-notification-context.service';
import { TelegramSupportTransportService } from '../telegram/telegram-support-transport.service';
import { EmailService } from '../email/email.service';
import {
	CampaignEmailNotificationRequestedEventPayload,
	CampaignTelegramNotificationRequestedEventPayload,
	DailySummaryTelegramNotificationRequestedEventPayload,
	OperationsBackupReportTelegramEventPayload,
	SubscriptionExpiryEmailNotificationRequestedEventPayload,
	SubscriptionExpiryTelegramNotificationRequestedEventPayload
} from '../messaging/delivery-event.types';
import {
	CAMPAIGN_EMAIL_NOTIFICATION_EVENT_TYPE,
	CAMPAIGN_TELEGRAM_NOTIFICATION_EVENT_TYPE,
	DAILY_SUMMARY_TELEGRAM_NOTIFICATION_EVENT_TYPE,
	OPERATIONS_BACKUP_REPORT_TELEGRAM_EVENT_TYPE,
	NotificationDeliveryKind,
	SUBSCRIPTION_EXPIRY_EMAIL_NOTIFICATION_EVENT_TYPE,
	SUBSCRIPTION_EXPIRY_TELEGRAM_NOTIFICATION_EVENT_TYPE
} from '../messaging/messaging.constants';
import { NotificationDeliveryEventPayload } from './notification-delivery-contract';
import { NotificationDeliveryPrismaService } from './prisma/notification-delivery-prisma.service';
import { TelegramInfoTransportService } from '../telegram/telegram-info-transport.service';
import { Injectable, Optional } from '@nestjs/common';
import { NotificationDeliveryReceiptStatus, Prisma } from '@prisma/notification-delivery-client';
import { CrmInvitationContextService } from './crm-invitation-context.service';
import { assertCrmInvitationEvent } from '../messaging/crm-invitation.contract';
import { assertCrmTaskReminderEvent } from '../messaging/crm-task-reminder.contract';
import { CrmTaskReminderContextService } from './crm-task-reminder-context.service';
import { CRM_TASK_REMINDER_EMAIL_EVENT_TYPE } from '../messaging/messaging.constants';
import { CRM_INTAKE_SLA_EMAIL_EVENT_TYPE } from '../messaging/messaging.constants';
import { assertCrmIntakeSlaEvent } from '../messaging/crm-intake-sla.contract';
import { CrmIntakeSlaContextService } from './crm-intake-sla-context.service';

export type NotificationDeliverySkipReason =
	| SupportNotificationSkipReason
	| 'WORKSPACE_CLOSED'
	| 'INVITATION_EXPIRED'
	| 'INVITATION_UNAVAILABLE'
	| 'TASK_REMINDER_UNAVAILABLE'
	| 'INTAKE_SLA_UNAVAILABLE';
export type NotificationDeliveryResult =
	| void
	| {
			status: 'SKIPPED';
			reason: NotificationDeliverySkipReason;
	  }
	| { status: 'DEFERRED'; retryAt: string };

@Injectable()
export class NotificationDeliveryAdapterService {
	constructor(
		private readonly emailService: EmailService,
		private readonly telegram: TelegramInfoTransportService,
		private readonly prisma: NotificationDeliveryPrismaService,
		private readonly invitationContext: CrmInvitationContextService,
		private readonly reminderContext: CrmTaskReminderContextService,
		@Optional()
		private readonly slaContext?: CrmIntakeSlaContextService,
		@Optional()
		private readonly supportContext?: SupportNotificationContextService,
		@Optional()
		private readonly supportTelegram?: TelegramSupportTransportService
	) {}

	async deliver(
		kind: NotificationDeliveryKind,
		event: NotificationDeliveryEventPayload,
		eventId: string,
		lockToken?: string
	): Promise<NotificationDeliveryResult> {
		switch (kind) {
			case 'support-team-email':
			case 'support-team-telegram':
			case 'support-client-email': {
				assertSupportNotificationEvent(event);
				if (
					!lockToken ||
					event.eventId !== eventId ||
					event.eventType !== SUPPORT_NOTIFICATION_EVENT_TYPES[kind] ||
					!this.supportContext
				)
					throw new Error(
						'Support notification requires a matching active claim'
					);
				const context = await this.supportContext.resolve(event, kind);
				if (!context.deliver)
					return { status: 'SKIPPED', reason: context.reason };
				const claim =
					await this.prisma.notificationDeliveryReceipt.findFirst({
						where: {
							eventId,
							consumer: kind,
							status: NotificationDeliveryReceiptStatus.PROCESSING,
							lockToken,
							leaseExpiresAt: { gt: new Date() }
						},
						select: { leaseExpiresAt: true }
					});
				if (
					!claim?.leaseExpiresAt ||
					claim.leaseExpiresAt.getTime() <= Date.now() + 15000
				)
					throw new Error(
						'Support notification claim is no longer active'
					);
				if ('email' in context.destination) {
					await this.emailService.sendSupportNotification(
						context.destination.email,
						context.content,
						kind === 'support-client-email',
						eventId
					);
				} else {
					if (!this.supportTelegram)
						throw new Error(
							'Support Telegram transport is not configured'
						);
					await this.supportTelegram.sendMessage(
						context.destination.telegramChatId,
						`${context.content.notificationType === 'NEW_CONVERSATION' ? 'Новое обращение в поддержку' : 'Новое сообщение в поддержке'} №${context.content.conversationNumber}\n${supportConversationUrl(context.content, false)}`,
						{
							messageThreadId: context.destination.messageThreadId,
							parseMode: null
						}
					);
				}
				return;
			}
			case 'crm-intake-sla-email':
			case 'crm-intake-sla-telegram': {
				assertCrmIntakeSlaEvent(event);
				if (
					!lockToken ||
					event.eventId !== eventId ||
					!this.slaContext ||
					(kind === 'crm-intake-sla-email') !==
						(event.eventType === CRM_INTAKE_SLA_EMAIL_EVENT_TYPE)
				)
					throw new Error(
						'aeroCRM Intake SLA requires a matching active claim'
					);
				const context = await this.slaContext.resolve(event);
				if (!context.deliver)
					return { status: 'SKIPPED', reason: 'INTAKE_SLA_UNAVAILABLE' };
				const claim =
					await this.prisma.notificationDeliveryReceipt.findFirst({
						where: {
							eventId,
							consumer: kind,
							status: NotificationDeliveryReceiptStatus.PROCESSING,
							lockToken,
							leaseExpiresAt: { gt: new Date() }
						},
						select: { leaseExpiresAt: true }
					});
				if (
					!claim?.leaseExpiresAt ||
					claim.leaseExpiresAt.getTime() <= Date.now()
				)
					throw new Error('aeroCRM Intake SLA claim is no longer active');
				if (!(await this.permitCrmDispatch(eventId, kind, lockToken, event.reference.workspaceId)))
					return { status: 'SKIPPED', reason: 'WORKSPACE_CLOSED' };
				if (context.channel === 'EMAIL')
					await this.emailService.sendCrmIntakeSla(
						context.destination.email!,
						context.content,
						eventId
					);
				else
					await this.telegram.sendMessage(
						context.destination.telegramChatId!,
						`Обращение без ответа в aeroCRM\n${context.content.title}\nСрок взятия в работу: ${new Date(context.content.dueAt).toLocaleString('ru-RU', { timeZone: context.content.timeZone })} (${context.content.timeZone})\nhttps://workspace.aerocrm.space/inbox?entry=${context.content.entryId}`,
						{ parseMode: null }
					);
				return;
			}
			case 'crm-task-reminder-email':
			case 'crm-task-reminder-telegram': {
				assertCrmTaskReminderEvent(event);
				if (
					!lockToken ||
					event.eventId !== eventId ||
					(kind === 'crm-task-reminder-email') !==
						(event.eventType === CRM_TASK_REMINDER_EMAIL_EVENT_TYPE)
				)
					throw new Error(
						'aeroCRM task reminder requires a matching active claim'
					);
				const context = await this.reminderContext.resolve(event);
				if (!context.deliver)
					return context.retryAt
						? { status: 'DEFERRED', retryAt: context.retryAt }
						: { status: 'SKIPPED', reason: 'TASK_REMINDER_UNAVAILABLE' };
				const claim =
					await this.prisma.notificationDeliveryReceipt.findFirst({
						where: {
							eventId,
							consumer: kind,
							status: NotificationDeliveryReceiptStatus.PROCESSING,
							lockToken,
							leaseExpiresAt: { gt: new Date() }
						},
						select: { leaseExpiresAt: true }
					});
				if (
					!claim?.leaseExpiresAt ||
					claim.leaseExpiresAt.getTime() <= Date.now()
				)
					throw new Error(
						'aeroCRM task reminder claim is no longer active'
					);
				if (!(await this.permitCrmDispatch(eventId, kind, lockToken, event.reference.workspaceId)))
					return { status: 'SKIPPED', reason: 'WORKSPACE_CLOSED' };
				if (context.channel === 'EMAIL')
					await this.emailService.sendCrmTaskReminder(
						context.destination.email!,
						context.content,
						eventId
					);
				else
					await this.telegram.sendMessage(
						context.destination.telegramChatId!,
						`${context.content.trigger === 'ASSIGNED' ? 'Назначение задачи aeroCRM' : 'Напоминание о задаче aeroCRM'}\n${context.content.title}\nСрок: ${new Date(context.content.dueAt).toLocaleString('ru-RU', { timeZone: context.content.timeZone })} (${context.content.timeZone})\nhttps://workspace.aerocrm.space/planner?task=${context.content.taskId}`,
						{ parseMode: null }
					);
				return;
			}
			case 'crm-invitation-email': {
				assertCrmInvitationEvent(event);
				if (!lockToken || event.eventId !== eventId)
					throw new Error(
						'aeroCRM invitation delivery requires a matching active claim'
					);
				if (Date.parse(event.content.expiresAt) <= Date.now())
					return { status: 'SKIPPED', reason: 'INVITATION_EXPIRED' };
				if (!(await this.invitationContext.canDeliver(event)))
					return { status: 'SKIPPED', reason: 'INVITATION_UNAVAILABLE' };
				// Eligibility can expire while its HTTP response is in flight.
				if (Date.parse(event.content.expiresAt) <= Date.now())
					return { status: 'SKIPPED', reason: 'INVITATION_EXPIRED' };
				if (!(await this.permitCrmDispatch(eventId, kind, lockToken, event.reference.workspaceId)))
					return { status: 'SKIPPED', reason: 'WORKSPACE_CLOSED' };
				await this.emailService.sendCrmInvitation(
					event.destination.email,
					event.reference.id,
					event.content.expiresAt,
					eventId
				);
				return;
			}
			case 'campaign-email':
				await this.sendCampaignEmail(
					this.getCampaignEmailEvent(event),
					eventId
				);
				return;
			case 'campaign-telegram':
				if (!lockToken) {
					throw new Error(
						'Campaign Telegram delivery requires an active claim'
					);
				}
				await this.sendCampaignTelegram(
					this.getCampaignTelegramEvent(event),
					eventId,
					lockToken
				);
				return;
			case 'daily-summary-delivery-telegram':
				await this.sendDailySummaryTelegram(
					this.getDailySummaryTelegramEvent(event)
				);
				return;
			case 'operations-backup-report-telegram': {
				const report = event as OperationsBackupReportTelegramEventPayload;
				if (report.eventType !== OPERATIONS_BACKUP_REPORT_TELEGRAM_EVENT_TYPE) throw new Error('Invalid Operations backup report event');
				await this.telegram.sendMessage(report.destination.telegramChatId, report.content.text, {
					messageThreadId: report.destination.messageThreadId,
					parseMode: 'HTML',
					button: { text: 'Открыть S3', url: report.content.consoleUrl }
				});
				return;
			}
			case 'subscription-expiry-email':
				await this.sendSubscriptionExpiryEmail(
					this.getSubscriptionExpiryEmailEvent(event),
					eventId
				);
				return;
			case 'subscription-expiry-telegram':
				await this.sendSubscriptionExpiryTelegram(
					this.getSubscriptionExpiryTelegramEvent(event)
				);
				return;
		}
	}

	private getCampaignEmailEvent(
		event: NotificationDeliveryEventPayload
	): CampaignEmailNotificationRequestedEventPayload {
		const value = event as CampaignEmailNotificationRequestedEventPayload;
		if (
			value?.schemaVersion !== 2 ||
			value?.eventType !== CAMPAIGN_EMAIL_NOTIFICATION_EVENT_TYPE
		) {
			throw new Error('Invalid campaign email event payload');
		}
		return value;
	}

	private getCampaignTelegramEvent(
		event: NotificationDeliveryEventPayload
	): CampaignTelegramNotificationRequestedEventPayload {
		const value =
			event as CampaignTelegramNotificationRequestedEventPayload;
		if (
			value?.schemaVersion !== 2 ||
			value?.eventType !== CAMPAIGN_TELEGRAM_NOTIFICATION_EVENT_TYPE
		) {
			throw new Error('Invalid campaign Telegram event payload');
		}
		return value;
	}

	private getDailySummaryTelegramEvent(
		event: NotificationDeliveryEventPayload
	): DailySummaryTelegramNotificationRequestedEventPayload {
		const value =
			event as DailySummaryTelegramNotificationRequestedEventPayload;
		if (
			value?.schemaVersion !== 1 ||
			value?.eventType !== DAILY_SUMMARY_TELEGRAM_NOTIFICATION_EVENT_TYPE
		) {
			throw new Error('Invalid daily summary Telegram event payload');
		}
		return value;
	}

	private getSubscriptionExpiryEmailEvent(
		event: NotificationDeliveryEventPayload
	): SubscriptionExpiryEmailNotificationRequestedEventPayload {
		const value =
			event as SubscriptionExpiryEmailNotificationRequestedEventPayload;
		if (
			value?.schemaVersion !== 1 ||
			value?.eventType !==
				SUBSCRIPTION_EXPIRY_EMAIL_NOTIFICATION_EVENT_TYPE
		) {
			throw new Error('Invalid subscription expiry email event payload');
		}
		return value;
	}

	private getSubscriptionExpiryTelegramEvent(
		event: NotificationDeliveryEventPayload
	): SubscriptionExpiryTelegramNotificationRequestedEventPayload {
		const value =
			event as SubscriptionExpiryTelegramNotificationRequestedEventPayload;
		if (
			value?.schemaVersion !== 1 ||
			value?.eventType !==
				SUBSCRIPTION_EXPIRY_TELEGRAM_NOTIFICATION_EVENT_TYPE
		) {
			throw new Error(
				'Invalid subscription expiry Telegram event payload'
			);
		}
		return value;
	}

	private async permitCrmDispatch(
		eventId: string,
		kind: NotificationDeliveryKind,
		lockToken: string | undefined,
		workspaceId: string
	): Promise<boolean> {
		if (!lockToken) throw new Error('CRM_DISPATCH_CLAIM_MISSING');
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.prisma.$transaction(async tx => {
					await tx.$executeRaw`SELECT notification_delivery.assert_workspace_open(${workspaceId}::uuid)`;
					const permitted = await tx.$queryRaw<Array<{ id: string }>>`
						UPDATE notification_delivery.delivery_receipts
						SET crm_workspace_id = COALESCE(crm_workspace_id, ${workspaceId}::uuid),
							crm_dispatch_started_at = COALESCE(crm_dispatch_started_at, clock_timestamp())
						WHERE event_id = ${eventId}::uuid AND consumer = ${kind}
							AND status = 'PROCESSING' AND lock_token = ${lockToken}::uuid
							AND lease_expires_at > clock_timestamp()
							AND (crm_workspace_id IS NULL OR crm_workspace_id = ${workspaceId}::uuid)
						RETURNING id`;
					if (permitted.length !== 1)
						throw new Error('CRM_DISPATCH_CLAIM_LOST');
					return true;
				});
			} catch (error) {
				if (String(error).includes('crm_workspace_closed')) {
					await this.prisma.notificationDeliveryReceipt.updateMany({
						where: {
							eventId,
							consumer: kind,
							status: NotificationDeliveryReceiptStatus.PROCESSING,
							lockToken,
							OR: [{ crmWorkspaceId: null }, { crmWorkspaceId: workspaceId }]
						},
						data: { crmWorkspaceId: workspaceId }
					});
					return false;
				}
				if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError &&
					(error.code === 'P2034' || (error.code === 'P2010' &&
						['40001', '40P01'].includes(String(error.meta?.code))))) continue;
				throw error;
			}
		}
	}

	private async sendCampaignEmail(
		event: CampaignEmailNotificationRequestedEventPayload,
		eventId: string
	): Promise<void> {
		await this.emailService.sendAdminBroadcast(
			event.destination.email,
			event.content,
			{ messageId: `<${eventId}.campaign@aerocrm.space>` }
		);
	}

	private async sendCampaignTelegram(
		event: CampaignTelegramNotificationRequestedEventPayload,
		eventId: string,
		lockToken: string
	): Promise<void> {
		const messages = this.buildTelegramBroadcastMessages(
			event.content.subject,
			event.content.message
		);
		const nextChunkIndex = await this.getCampaignTelegramCheckpoint(
			eventId,
			lockToken,
			messages.length
		);

		for (let index = nextChunkIndex; index < messages.length; index += 1) {
			await this.telegram.sendMessage(
				event.destination.telegramChatId,
				messages[index],
				{ parseMode: null }
			);
			const checkpoint =
				await this.prisma.notificationDeliveryReceipt.updateMany({
					where: {
						eventId,
						consumer: 'campaign-telegram',
						status: NotificationDeliveryReceiptStatus.PROCESSING,
						lockToken
					},
					data: {
						checkpoint: { nextChunkIndex: index + 1 }
					}
				});
			if (checkpoint.count !== 1) {
				throw new Error(
					'Campaign Telegram delivery checkpoint claim was lost'
				);
			}
		}
	}

	private async getCampaignTelegramCheckpoint(
		eventId: string,
		lockToken: string,
		messageCount: number
	): Promise<number> {
		const receipt =
			await this.prisma.notificationDeliveryReceipt.findFirst({
				where: {
					eventId,
					consumer: 'campaign-telegram',
					status: NotificationDeliveryReceiptStatus.PROCESSING,
					lockToken
				},
				select: { checkpoint: true }
			});
		if (!receipt) {
			throw new Error('Campaign Telegram delivery claim was lost');
		}
		const checkpoint = receipt.checkpoint;
		const value =
			checkpoint &&
			typeof checkpoint === 'object' &&
			!Array.isArray(checkpoint)
				? checkpoint.nextChunkIndex
				: 0;
		if (
			!Number.isInteger(value) ||
			Number(value) < 0 ||
			Number(value) > messageCount
		) {
			throw new Error('Invalid campaign Telegram delivery checkpoint');
		}
		return Number(value);
	}

	private async sendDailySummaryTelegram(
		event: DailySummaryTelegramNotificationRequestedEventPayload
	): Promise<void> {
		await this.telegram.sendMessage(
			event.destination.telegramChatId,
			event.content.text,
			{
				messageThreadId: event.destination.messageThreadId,
				parseMode: 'HTML'
			}
		);
	}

	private async sendSubscriptionExpiryEmail(
		event: SubscriptionExpiryEmailNotificationRequestedEventPayload,
		eventId: string
	): Promise<void> {
		await this.emailService.sendSubscriptionExpiryReminder(
			event.destination.email,
			event.content,
			{
				messageId: `<${eventId}.subscription-expiry@aerocrm.space>`
			}
		);
	}

	private async sendSubscriptionExpiryTelegram(
		event: SubscriptionExpiryTelegramNotificationRequestedEventPayload
	): Promise<void> {
		await this.telegram.sendMessage(
			event.destination.telegramChatId,
			this.buildSubscriptionExpiryTelegramMessage(event.content),
			{ parseMode: 'HTML' }
		);
	}

	private buildTelegramBroadcastMessages(
		subject: string,
		message: string
	): string[] {
		const chunks: string[] = [];
		let rest = message;
		while (rest.length > 3500) {
			const slice = rest.slice(0, 3500);
			const lastLineBreak = slice.lastIndexOf('\n');
			const splitAt = lastLineBreak > 2100 ? lastLineBreak + 1 : 3500;
			chunks.push(rest.slice(0, splitAt).trimEnd());
			rest = rest.slice(splitAt).trimStart();
		}
		if (rest) chunks.push(rest);
		if (!chunks.length) chunks.push('');
		return chunks.map((chunk, index) =>
			index === 0 ? [subject, '', chunk].join('\n') : chunk
		);
	}

	private buildSubscriptionExpiryTelegramMessage(content: {
		daysBeforeExpiry: number;
		planLabel: string;
		expiresAtLabel: string;
	}): string {
		const statusText =
			content.daysBeforeExpiry === 0
				? 'Сегодня последний день подписки.'
				: `До окончания подписки осталось ${content.daysBeforeExpiry} ${this.getDayWord(content.daysBeforeExpiry)}.`;
		return [
			'<b>Подписка aerocrm.space</b>',
			`Тариф: ${this.escapeHtml(content.planLabel)}`,
			`Дата окончания: ${this.escapeHtml(content.expiresAtLabel)} МСК`,
			'',
			statusText,
			'',
			'Продлить доступ можно в личном кабинете.'
		].join('\n');
	}

	private getDayWord(value: number): string {
		const mod10 = value % 10;
		const mod100 = value % 100;
		if (mod10 === 1 && mod100 !== 11) return 'день';
		if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) {
			return 'дня';
		}
		return 'дней';
	}

	private escapeHtml(value: string): string {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}
}
