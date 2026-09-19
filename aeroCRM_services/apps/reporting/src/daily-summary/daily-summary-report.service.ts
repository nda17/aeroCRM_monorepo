import { Injectable } from '@nestjs/common';
import { ReportingPrismaService } from '../prisma/reporting-prisma.service';

interface SummaryRow {
	registered: bigint;
	paidOrders: bigint;
	revenueMinor: bigint;
	activePaid: bigint;
	activeTrial: bigint;
	expiring7d: bigint;
}

@Injectable()
export class DailySummaryReportService {
	constructor(private readonly prisma: ReportingPrismaService) {}

	async render(periodStart: Date, periodEnd: Date): Promise<string> {
		const [users, orders, crm] = await Promise.all([
			this.prisma.identityUserProjection.count({
				where: { tombstoned: false, deletedAt: null, createdAt: { gte: periodStart, lt: periodEnd } }
			}),
			this.prisma.$queryRaw<Pick<SummaryRow, 'paidOrders' | 'revenueMinor'>[]>`
				SELECT count(*)::bigint AS "paidOrders",
					COALESCE(sum(amount_minor), 0)::bigint AS "revenueMinor"
				FROM reporting.crm_order_facts
				WHERE tombstoned = FALSE AND paid_at >= ${periodStart} AND paid_at < ${periodEnd}`,
			this.prisma.$queryRaw<Pick<SummaryRow, 'activePaid' | 'activeTrial' | 'expiring7d'>[]>`
				SELECT count(*) FILTER (WHERE plan_code = 'PAID' AND status = 'ACTIVE' AND effective_until > now())::bigint AS "activePaid",
					count(*) FILTER (WHERE plan_code = 'TRIAL' AND status = 'ACTIVE' AND effective_until > now())::bigint AS "activeTrial",
					count(*) FILTER (WHERE status = 'ACTIVE' AND effective_until BETWEEN now() AND now() + INTERVAL '7 days')::bigint AS "expiring7d"
				FROM reporting.crm_entitlement_projections WHERE tombstoned = FALSE`
		]);
		const paidOrders = Number(orders[0]?.paidOrders ?? 0);
		const revenueMinor = Number(orders[0]?.revenueMinor ?? 0);
		const rub = (revenueMinor / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return [
			`📊 aeroCRM — сводка за ${periodStart.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
			`Новые пользователи: ${users}`,
			`Оплаченные заказы CRM: ${paidOrders}`,
			`Выручка CRM: ${rub} ₽`,
			`Активные оплаченные рабочие области: ${Number(crm[0]?.activePaid ?? 0)}`,
			`Активные пробные рабочие области: ${Number(crm[0]?.activeTrial ?? 0)}`,
			`Доступ истекает в течение 7 дней: ${Number(crm[0]?.expiring7d ?? 0)}`
		].join('\n');
	}
}
