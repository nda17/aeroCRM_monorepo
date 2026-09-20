import EmailLayout from './_components/email-layout';
import { Text } from '@react-email/components';
import * as React from 'react';

export default function CrmInvitationEmail({
	invitationId,
	expiresAtLabel
}: {
	invitationId: string;
	expiresAtLabel: string;
}) {
	return (
		<EmailLayout
			preview="Приглашение в aeroCRM"
			title="Приглашение в aeroCRM"
			subtitle={`Действует до ${expiresAtLabel} МСК`}
			actionLabel="Открыть приглашение"
			actionHref={`https://workspace.aerocrm.space/invitations/${invitationId}`}
		>
			<Text className="ww-primary-text">
				Вас пригласили в команду aeroCRM. Войдите с адресом электронной
				почты, на который отправлено это письмо.
			</Text>
			<Text className="ww-secondary-text">
				Ссылка сама по себе не предоставляет доступ. Он появится только
				после подтверждения электронной почты, принятия приглашения и
				проверки доступных мест.
			</Text>
			<Text className="ww-note-text">
				Если вы не ожидаете это приглашение, просто проигнорируйте письмо.
				Отменённое или просроченное приглашение принять нельзя.
			</Text>
		</EmailLayout>
	);
}
