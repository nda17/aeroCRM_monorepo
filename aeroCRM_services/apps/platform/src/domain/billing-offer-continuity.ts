import { createHash, randomUUID } from 'node:crypto';

export const BILLING_OFFER_CHANGED_EVENT_TYPE = 'billing.offer.changed.v2';
export const BILLING_OFFER_PRODUCER_CONTRACT_VERSION = 2 as const;
export const BILLING_OFFER_SOURCE_SEQUENCE_SCOPE =
	'billing.offer:offer' as const;
export const AUTO_RENEWAL_CONSENT_VERSION = 'aerocrm-auto-renewal-2026-09-20-v1';
export const AUTO_RENEWAL_CONSENT_TEXT =
	'Я соглашаюсь сохранить способ оплаты в ЮKassa, автоматически продлевать подписку aeroCRM и списывать указанную на странице оплаты сумму с выбранной периодичностью. При недостатке средств или временной недоступности банка Исполнитель вправе выполнить после первого отказа не более двух повторных попыток ориентировочно через 24 и 72 часа. Запрос на каждую повторную попытку может быть отправлен в течение не более одного часа после расчётного момента; если это окно пропущено, такая попытка не выполняется. Новый период начинается только после успешного списания. Автопродление можно отключить в личном кабинете или через info@aerocrm.space в любое время до отправки очередного запроса на списание; оплаченный период сохранится. Новая стоимость применяется только после отдельного подтверждения.';

const AUTO_RENEWAL_OFFER_SECTION_PATTERN =
	/<section data-aerocrm-section="auto-renewal-v1">[\s\S]*?<\/section>/;
const AUTO_RENEWAL_OFFER_SECTION_SHA256 =
	'c464eb43cd538e455c37319e9ea9fc19b9be7edfcb4f1f345e9ee6428fcf5364';

export interface BillingOfferContinuityState {
	producerContractVersion: number;
	sourceSequenceScope: string;
	currentAggregateVersion: bigint;
	currentSourceSequence: bigint;
}

export interface BillingOfferCursor {
	aggregateVersion: bigint;
	sourceSequence: bigint;
}

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

export function nextBillingOfferCursor(
	state: BillingOfferContinuityState
): BillingOfferCursor {
	if (
		state.producerContractVersion !==
			BILLING_OFFER_PRODUCER_CONTRACT_VERSION ||
		state.sourceSequenceScope !== BILLING_OFFER_SOURCE_SEQUENCE_SCOPE ||
		state.currentAggregateVersion < 0n ||
		state.currentSourceSequence < 0n
	) {
		throw new Error('BILLING_OFFER_SCOPED_CURSOR_INVALID');
	}
	return {
		aggregateVersion: state.currentAggregateVersion + 1n,
		sourceSequence: state.currentSourceSequence + 1n
	};
}

export function buildBillingOfferChangedEvent(input: {
	content: string;
	updatedAt: Date;
	cursor: BillingOfferCursor;
	eventId?: string;
}) {
	if (!isAutoRenewalOfferCompatible(input.content)) {
		throw new Error('BILLING_OFFER_CONSENT_SECTION_INCOMPATIBLE');
	}
	const eventId = input.eventId || randomUUID();
	return {
		schemaVersion: 2 as const,
		eventType: BILLING_OFFER_CHANGED_EVENT_TYPE,
		eventId,
		aggregateId: 'offer' as const,
		aggregateVersion: input.cursor.aggregateVersion.toString(),
		sourceSequenceContractVersion: BILLING_OFFER_PRODUCER_CONTRACT_VERSION,
		sourceSequenceScope: BILLING_OFFER_SOURCE_SEQUENCE_SCOPE,
		sourceSequence: input.cursor.sourceSequence.toString(),
		occurredAt: input.updatedAt.toISOString(),
		tombstone: false as const,
		state: {
			id: 'offer' as const,
			content: input.content,
			sha256: createHash('sha256')
				.update(input.content, 'utf8')
				.digest('hex'),
			updatedAt: input.updatedAt.toISOString(),
			consentVersion: AUTO_RENEWAL_CONSENT_VERSION,
			consentText: AUTO_RENEWAL_CONSENT_TEXT
		}
	};
}
