import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
	CrmCommercialPolicy,
	CrmOrder,
	CrmPaidPeriod,
	CrmAutoRenewal
} from '@prisma/billing-client';
import { billingCommandRequestHash } from './billing-command-idempotency';
import type {
	CrmBillingCycle,
	CrmCommerceCommand,
	CrmOrderView,
	CrmPaidPeriodView,
	CrmPriceSnapshot,
	CrmRenewalView
} from './crm-commerce.contract';

export const AEROCRM_CONSENT_VERSION = 'aerocrm-auto-renewal-2026-09-20-v1';
export const AEROCRM_CONSENT_TEXT =
	'Я соглашаюсь сохранить способ оплаты в ЮKassa, автоматически продлевать подписку aeroCRM и списывать указанную на странице оплаты сумму с выбранной периодичностью. При недостатке средств или временной недоступности банка Исполнитель вправе выполнить после первого отказа не более двух повторных попыток ориентировочно через 24 и 72 часа. Запрос на каждую повторную попытку может быть отправлен в течение не более одного часа после расчётного момента; если это окно пропущено, такая попытка не выполняется. Новый период начинается только после успешного списания. Автопродление можно отключить в личном кабинете или через info@aerocrm.space в любое время до отправки очередного запроса на списание; оплаченный период сохранится. Новая стоимость применяется только после отдельного подтверждения.'
export const AEROCRM_DAY_MS = 86_400_000;
export const AEROCRM_UUID =
	/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const AEROCRM_HASH = /^[a-f0-9]{64}$/;
export const AEROCRM_MAX_AMOUNT = 1_000_000_000_000n;

export function commerceConflict(code: string): never {
	throw new ConflictException({
		code,
		message: 'Состояние оплаты aeroCRM изменилось'
	});
}
export function commerceInvalid(): never {
	throw new BadRequestException({
		code: 'crm_commerce_invalid_request',
		message: 'Некорректный запрос aeroCRM'
	});
}
export function commerceRecord(
	value: unknown
): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function commerceText(
	value: unknown,
	maximum: number
): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= maximum &&
		!/[\u0000-\u001f\u007f\ufffd]/u.test(value) &&
		!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
			value
		)
	);
}
export function commerceUuid(value: unknown): value is string {
	return typeof value === 'string' && AEROCRM_UUID.test(value);
}
export function commerceVersion(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^(0|[1-9][0-9]{0,18})$/.test(value) &&
		BigInt(value) <= 9_223_372_036_854_775_807n
	);
}
export function commerceInt(
	value: unknown,
	minimum: number,
	maximum: number
): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= minimum &&
		value <= maximum
	);
}
export function commerceCycle(
	value: unknown
): value is CrmBillingCycle {
	return value === 'MONTHLY' || value === 'YEARLY';
}
export function crmCommerceRequestHash(
	commandType: string,
	command: CrmCommerceCommand
): string {
	const { capacityFence: _capacityFence, ...payload } =
		command as unknown as Record<string, unknown>;
	void _capacityFence;
	return billingCommandRequestHash(commandType, payload);
}
export function crmProviderKey(...parts: string[]): string {
	return createHash('sha256')
		.update(JSON.stringify(['AEROCRM', ...parts]))
		.digest('hex');
}
export function crmPriceSnapshot(
	policy: CrmCommercialPolicy
): CrmPriceSnapshot {
	return {
		policyVersion: policy.version,
		monthlyPriceMinor: policy.monthlyPriceMinor,
		yearlyPriceMinor: policy.yearlyPriceMinor,
		additionalSeatMonthlyPriceMinor:
			policy.additionalSeatMonthlyPriceMinor,
		additionalSeatYearlyPriceMinor: policy.additionalSeatYearlyPriceMinor,
		includedSeats: policy.includedSeats,
		graceDays: policy.graceDays
	};
}
export function readCrmPriceSnapshot(
	value: unknown
): CrmPriceSnapshot {
	if (
		!commerceRecord(value) ||
		Object.keys(value).length !== 7 ||
		!commerceInt(value.policyVersion, 1, 2147483646) ||
		!commerceInt(value.monthlyPriceMinor, 1, 100000000) ||
		!commerceInt(value.yearlyPriceMinor, 1, 100000000) ||
		!commerceInt(value.additionalSeatMonthlyPriceMinor, 0, 100000000) ||
		!commerceInt(value.additionalSeatYearlyPriceMinor, 0, 100000000) ||
		!commerceInt(value.includedSeats, 2, 10000) ||
		value.graceDays !== 3
	)
		throw new Error('aeroCRM price snapshot is invalid');
	return value as unknown as CrmPriceSnapshot;
}
export function crmPrice(
	snapshot: CrmPriceSnapshot,
	cycle: CrmBillingCycle,
	seats: number
): bigint {
	readCrmPriceSnapshot(snapshot);
	if (
		!commerceInt(seats, snapshot.includedSeats, 10000) ||
		!commerceCycle(cycle)
	)
		commerceInvalid();
	const result =
		BigInt(
			cycle === 'MONTHLY'
				? snapshot.monthlyPriceMinor
				: snapshot.yearlyPriceMinor
		) +
		BigInt(seats - snapshot.includedSeats) *
			BigInt(
				cycle === 'MONTHLY'
					? snapshot.additionalSeatMonthlyPriceMinor
					: snapshot.additionalSeatYearlyPriceMinor
			);
	if (result < 1n || result > AEROCRM_MAX_AMOUNT) commerceInvalid();
	return result;
}
export function crmDecimal(minor: bigint): string {
	if (minor < 1n || minor > AEROCRM_MAX_AMOUNT)
		throw new Error('aeroCRM amount is invalid');
	return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}
export function crmPeriodEnd(
	start: Date,
	cycle: CrmBillingCycle
): Date {
	if (!Number.isFinite(start.getTime()) || !commerceCycle(cycle))
		commerceInvalid();
	const end = new Date(start);
	const day = end.getUTCDate();
	end.setUTCDate(1);
	end.setUTCMonth(end.getUTCMonth() + (cycle === 'MONTHLY' ? 1 : 12));
	const last = new Date(end);
	last.setUTCMonth(last.getUTCMonth() + 1, 0);
	end.setUTCDate(Math.min(day, last.getUTCDate()));
	if (!Number.isFinite(end.getTime()) || end <= start) commerceInvalid();
	return end;
}
export function crmPeriodView(
	period: CrmPaidPeriod,
	now: Date
): CrmPaidPeriodView {
	return {
		id: period.id,
		orderId: period.orderId,
		version: period.version,
		cycle: period.cycle as CrmBillingCycle,
		totalSeats: period.totalSeats,
		priceSnapshot: readCrmPriceSnapshot(period.priceSnapshot),
		startsAt: period.startsAt.toISOString(),
		expiresAt: period.expiresAt.toISOString(),
		graceUntil: period.graceUntil.toISOString(),
		state:
			now < period.startsAt
				? 'SCHEDULED'
				: now < period.expiresAt
					? 'ACTIVE'
					: now < period.graceUntil
						? 'GRACE'
						: 'EXPIRED'
	};
}
export function crmOrderView(
	order: CrmOrder,
	period: CrmPaidPeriod | null,
	now: Date
): CrmOrderView {
	return {
		id: order.id,
		workspaceId: order.workspaceId,
		version: order.version,
		kind: order.kind as CrmOrderView['kind'],
		state: order.status as CrmOrderView['state'],
		cycle: order.cycle as CrmBillingCycle,
		totalSeats: order.totalSeats,
		amountMinor: order.amountMinor.toString(),
		currency: 'RUB',
		policyVersion: order.policyVersion,
		confirmationUrl:
			order.status === 'PENDING' ? order.confirmationUrl : null,
		canVerify:
			['PENDING', 'UNKNOWN'].includes(order.status) &&
			!!order.providerPaymentId,
		checkoutExpiresAt: order.checkoutExpiresAt.toISOString(),
		createdAt: order.createdAt.toISOString(),
		succeededAt: order.succeededAt?.toISOString() ?? null,
		fulfillment: !period
			? 'NONE'
			: now < period.startsAt
				? 'SCHEDULED'
				: now < period.expiresAt
					? 'ACTIVE'
					: 'EXPIRED',
		periodId: period?.id ?? null,
		startsAt: period?.startsAt.toISOString() ?? null,
		expiresAt: period?.expiresAt.toISOString() ?? null
	};
}
export function crmRenewalView(
	renewal: CrmAutoRenewal | null
): CrmRenewalView {
	return {
		version: renewal?.version ?? 0,
		state: (renewal?.status ?? 'NONE') as CrmRenewalView['state'],
		canDisable:
			!!renewal && !['USER_DISABLED', 'REVOKED'].includes(renewal.status),
		dispatchPending: renewal?.dispatchPending ?? false,
		nextChargeAt: renewal?.nextChargeAt.toISOString() ?? null,
		nextRetryAt: renewal?.nextRetryAt?.toISOString() ?? null,
		retryAttempt: renewal?.retryAttempt ?? 0,
		methodLast4: renewal?.paymentMethodLast4 ?? null,
		methodTitle: renewal?.paymentMethodTitle ?? null
	};
}
