import SupportNotificationEmail from '../../emails/support-notification.email';
import type { SupportNotificationContent } from '../messaging/support-notification.contract';
import AdminBroadcastEmail from '../../emails/admin-broadcast.email';
import SubscriptionExpiryReminderEmail from '../../emails/subscription-expiry-reminder.email';
import CrmInvitationEmail from '../../emails/crm-invitation.email';
import CrmTaskReminderEmail from '../../emails/crm-task-reminder.email';
import CrmIntakeSlaEmail from '../../emails/crm-intake-sla.email';
import type { SlaContent } from '../messaging/crm-intake-sla.contract';
import type { ReminderContent } from '../messaging/crm-task-reminder.contract';
import { EMAIL_TRANSPORTER } from '../config/mailer.config';
import { Inject, Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import type { Transporter } from 'nodemailer';
import { join } from 'node:path';

const EMAIL_LOGO_CID = 'aerocrm-notification-logo';
const EMAIL_LOGO_PATH = join(process.cwd(), 'assets', 'email-logo.png');

interface SubscriptionExpiryReminderPayload {
	daysBeforeExpiry: number;
	planLabel: string;
	expiresAtLabel: string;
}

@Injectable()
export class EmailService {
	constructor(
		@Inject(EMAIL_TRANSPORTER)
		private readonly mailer: Transporter
	) {}

	sendEmail(
		to: string,
		subject: string,
		html: string,
		options: { messageId?: string } = {}
	) {
		return this.mailer.sendMail({
			to,
			subject,
			html,
			attachments: [
				{
					filename: 'aerocrm-logo.png',
					path: EMAIL_LOGO_PATH,
					cid: EMAIL_LOGO_CID,
					contentDisposition: 'inline'
				}
			],
			...options
		});
	}

	sendAdminBroadcast(
		to: string,
		data: { subject: string; message: string },
		options: { messageId?: string } = {}
	) {
		const html = render(AdminBroadcastEmail(data));
		return this.sendEmail(to, data.subject, html, options);
	}

	sendSubscriptionExpiryReminder(
		to: string,
		data: SubscriptionExpiryReminderPayload,
		options: { messageId?: string } = {}
	) {
		const html = render(SubscriptionExpiryReminderEmail(data));
		const subject =
			data.daysBeforeExpiry === 0
				? 'Сегодня последний день подписки aeroCRM'
				: `Подписка aeroCRM закончится через ${this.getDaysLabel(data.daysBeforeExpiry)}`;

		return this.sendEmail(to, subject, html, options);
	}

	sendCrmInvitation(
		to: string,
		invitationId: string,
		expiresAt: string,
		eventId: string
	) {
		const html = render(
			CrmInvitationEmail({
				invitationId,
				expiresAtLabel: new Date(expiresAt).toLocaleString('ru-RU', {
					timeZone: 'Europe/Moscow'
				})
			})
		);
		return this.sendEmail(to, 'Приглашение в aeroCRM', html, {
			messageId: `<${eventId}.crm-invitation@aerocrm.space>`
		});
	}

	private getDaysLabel(days: number): string {
		const mod10 = days % 10;
		const mod100 = days % 100;
		if (mod10 === 1 && mod100 !== 11) return `${days} день`;
		if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) {
			return `${days} дня`;
		}
		return `${days} дней`;
	}

	sendCrmTaskReminder(
		to: string,
		content: ReminderContent,
		eventId: string
	) {
		const html = render(
			CrmTaskReminderEmail({
				...content,
				dueAtLabel: new Date(content.dueAt).toLocaleString('ru-RU', {
					timeZone: content.timeZone
				})
			})
		);
		return this.sendEmail(
			to,
			content.trigger === 'ASSIGNED'
				? 'Назначение задачи aeroCRM'
				: 'Напоминание о задаче aeroCRM',
			html,
			{
				messageId: `<${eventId}.crm-task-reminder@aerocrm.space>`
			}
		);
	}
	sendSupportNotification(
		to: string,
		content: SupportNotificationContent,
		client: boolean,
		eventId: string
	) {
		return this.sendEmail(
			to,
			client
				? 'Вам ответила поддержка'
				: 'Новое сообщение в поддержке aeroCRM',
			render(SupportNotificationEmail({ content, client })),
			{
				messageId: `<${eventId}.support-notification@aerocrm.space>`
			}
		);
	}
	sendCrmIntakeSla(to: string, content: SlaContent, eventId: string) {
		return this.sendEmail(
			to,
			'Обращение без ответа в aeroCRM',
			render(
				CrmIntakeSlaEmail({
					...content,
					dueAtLabel: new Date(content.dueAt).toLocaleString('ru-RU', {
						timeZone: content.timeZone
					})
				})
			),
			{ messageId: `<${eventId}.crm-intake-sla@aerocrm.space>` }
		);
	}
}
