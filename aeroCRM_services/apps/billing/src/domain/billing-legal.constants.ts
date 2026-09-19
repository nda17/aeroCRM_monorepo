import { createHash } from 'node:crypto';

export const AUTO_RENEWAL_CONSENT_VERSION = 'aerocrm-auto-renewal-2026-09-20-v1';

export const AUTO_RENEWAL_CONSENT_TEXT =
	'Я соглашаюсь сохранить способ оплаты в ЮKassa, автоматически продлевать подписку aeroCRM и списывать указанную на странице оплаты сумму с выбранной периодичностью. При недостатке средств или временной недоступности банка Исполнитель вправе выполнить после первого отказа не более двух повторных попыток ориентировочно через 24 и 72 часа. Запрос на каждую повторную попытку может быть отправлен в течение не более одного часа после расчётного момента; если это окно пропущено, такая попытка не выполняется. Новый период начинается только после успешного списания. Автопродление можно отключить в личном кабинете или через info@aerocrm.space в любое время до отправки очередного запроса на списание; оплаченный период сохранится. Новая стоимость применяется только после отдельного подтверждения.';

export const PROVIDER_IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const AUTO_RENEWAL_OFFER_SECTION_PATTERN =
	/<section data-aerocrm-section="auto-renewal-v1">[\s\S]*?<\/section>/;
const AUTO_RENEWAL_OFFER_SECTION_SHA256 =
	'c464eb43cd538e455c37319e9ea9fc19b9be7edfcb4f1f345e9ee6428fcf5364';

export function isAutoRenewalOfferCompatible(
	content?: string | null
): boolean {
	const section = content?.match(AUTO_RENEWAL_OFFER_SECTION_PATTERN)?.[0];
	if (!section) return false;
	return (
		createHash('sha256')
			.update(section.replace(/\s+/g, ' ').trim(), 'utf8')
			.digest('hex') === AUTO_RENEWAL_OFFER_SECTION_SHA256
	);
}
