import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/billing-client';
import { BillingPrismaService } from '../prisma/billing-prisma.service';

export const BILLING_ADMIN_ALERT_TYPES = [
	'EXPIRED_ACTIVE_CRM_ENTITLEMENT',
	'CRM_ENTITLEMENT_EXPIRES_SOON',
	'CRM_PROVIDER_OPERATION_UNKNOWN',
	'CRM_SUCCEEDED_ORDER_WITHOUT_ENTITLEMENT',
	'CRM_RECEIPT_PENDING'
] as const;

type AlertType = (typeof BILLING_ADMIN_ALERT_TYPES)[number];
type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
interface AlertRow {
	type: AlertType;
	severity: Severity;
	referenceId: string;
	ownerId: string;
	title: string;
	message: string;
	alertAt: Date;
}

@Injectable()
export class BillingAdminAlertsService {
	constructor(private readonly prisma: BillingPrismaService) {}

	async getAlerts() {
		const rows = await this.prisma.$queryRaw<AlertRow[]>(Prisma.sql`
			WITH alerts AS (
				SELECT 'EXPIRED_ACTIVE_CRM_ENTITLEMENT'::text AS type,
					'HIGH'::text AS severity, e.id AS "referenceId",
					a.owner_subject AS "ownerId",
					'Доступ CRM истёк'::text AS title,
					'Активное право CRM имеет прошедший срок'::text AS message,
					e.effective_until AS "alertAt"
				FROM billing.crm_entitlements e
				JOIN billing.crm_commerce_accounts a ON a.workspace_id = e.workspace_id
				WHERE e.status = 'ACTIVE' AND e.effective_until < NOW()
				UNION ALL
				SELECT 'CRM_ENTITLEMENT_EXPIRES_SOON', 'MEDIUM', e.id,
					a.owner_subject, 'Доступ CRM скоро истечёт',
					'До окончания права CRM осталось менее семи дней', e.effective_until
				FROM billing.crm_entitlements e
				JOIN billing.crm_commerce_accounts a ON a.workspace_id = e.workspace_id
				WHERE e.status = 'ACTIVE' AND e.effective_until BETWEEN NOW() AND NOW() + INTERVAL '7 days'
				UNION ALL
				SELECT 'CRM_PROVIDER_OPERATION_UNKNOWN', 'HIGH', op.id,
					o.owner_subject, 'Платёж CRM требует сверки',
					'Результат операции провайдера неизвестен', op.updated_at
				FROM billing.crm_provider_operations op
				JOIN billing.crm_orders o ON o.id = op.order_id
				WHERE op.status = 'UNKNOWN'
				UNION ALL
				SELECT 'CRM_SUCCEEDED_ORDER_WITHOUT_ENTITLEMENT', 'HIGH', o.id,
					o.owner_subject, 'Оплата CRM без активного доступа',
					'Успешный заказ не дал активного права CRM', o.succeeded_at
				FROM billing.crm_orders o
				LEFT JOIN billing.crm_entitlements e ON e.workspace_id = o.workspace_id
				WHERE o.status = 'SUCCEEDED' AND o.succeeded_at >= NOW() - INTERVAL '7 days'
					AND (e.id IS NULL OR e.status <> 'ACTIVE' OR e.effective_until < NOW())
				UNION ALL
				SELECT 'CRM_RECEIPT_PENDING', 'MEDIUM', r.id,
					o.owner_subject, 'Чек CRM ожидает регистрации',
					'Чек ожидает регистрации более 30 минут', r.created_at
				FROM billing.crm_payment_receipts r
				JOIN billing.crm_orders o ON o.id = r.order_id
				WHERE lower(r.status) = 'pending' AND r.created_at < NOW() - INTERVAL '30 minutes'
			)
			SELECT type, severity, "referenceId", "ownerId", title, message, "alertAt"
			FROM alerts ORDER BY "alertAt" ASC, type ASC, "referenceId" ASC
		`);
		const items = rows.map(row => ({ ...row, alertAt: row.alertAt.toISOString() }));
		const byType = Object.fromEntries(BILLING_ADMIN_ALERT_TYPES.map(type => [type, 0])) as Record<AlertType, number>;
		const bySeverity: Record<Severity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
		for (const item of items) { byType[item.type] += 1; bySeverity[item.severity] += 1; }
		return { schemaVersion: 1 as const, total: items.length, counts: { byType, bySeverity }, items };
	}
}
