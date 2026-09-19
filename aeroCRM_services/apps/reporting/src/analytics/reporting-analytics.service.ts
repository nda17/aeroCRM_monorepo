import { Injectable } from '@nestjs/common';
import { ReportingPrismaService } from '../prisma/reporting-prisma.service';

interface UserRow {
	total: bigint;
	active30d: bigint;
	new30d: bigint;
	admins: bigint;
	multiLoginUsers: bigint;
}
interface CrmRow {
	activePaid: bigint;
	activeTrial: bigint;
	expiring7d: bigint;
	expiredActive: bigint;
}
interface RevenueRow {
	totalMinor: bigint;
	last30dMinor: bigint;
	currentMonthMinor: bigint;
	paidOrders30d: bigint;
}
interface MonthRow {
	month: Date;
	revenueMinor: bigint;
	paidOrders: bigint;
}

@Injectable()
export class ReportingAnalyticsService {
	constructor(private readonly prisma: ReportingPrismaService) {}

	async getDashboard() {
		const [users, crm, revenue, months] = await Promise.all([
			this.userRow(),
			this.crmRow(),
			this.revenueRow(),
			this.prisma.$queryRaw<MonthRow[]>`
				SELECT date_trunc('month', paid_at) AS month,
					COALESCE(sum(amount_minor), 0)::bigint AS "revenueMinor",
					count(*)::bigint AS "paidOrders"
				FROM reporting.crm_order_facts
				WHERE tombstoned = FALSE AND paid_at >= date_trunc('month', now()) - INTERVAL '11 months'
				GROUP BY 1 ORDER BY 1 ASC`
		]);
		return {
			schemaVersion: 1,
			users: this.usersView(users[0]),
			crm: {
				activePaidWorkspaces: Number(crm[0]?.activePaid ?? 0),
				activeTrialWorkspaces: Number(crm[0]?.activeTrial ?? 0),
				expiring7d: Number(crm[0]?.expiring7d ?? 0),
				expiredActive: Number(crm[0]?.expiredActive ?? 0)
			},
			revenue: {
				totalMinor: Number(revenue[0]?.totalMinor ?? 0),
				last30dMinor: Number(revenue[0]?.last30dMinor ?? 0),
				currentMonthMinor: Number(revenue[0]?.currentMonthMinor ?? 0),
				paidOrders30d: Number(revenue[0]?.paidOrders30d ?? 0),
				monthly: months.map(row => ({
					month: row.month.toISOString().slice(0, 7),
					revenueMinor: Number(row.revenueMinor),
					paidOrders: Number(row.paidOrders)
				}))
			}
		};
	}

	async getOverview() {
		const rows = await this.userRow();
		const users = this.usersView(rows[0]);
		return {
			totalUsers: users.total,
			activeUsers30d: users.active30d,
			newUsers30d: users.new30d,
			multiLoginUsers: users.multiLoginUsers,
			adminUsers: users.admins
		};
	}

	async getRegistrationsByMonth() {
		const rows = await this.prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
			SELECT date_trunc('month', created_at) AS month, count(*)::bigint AS count
			FROM reporting.identity_user_projections
			WHERE tombstoned = FALSE AND deleted_at IS NULL
				AND created_at >= date_trunc('month', now()) - INTERVAL '11 months'
			GROUP BY 1 ORDER BY 1 ASC`;
		const counts = new Map(rows.map(row => [row.month.toISOString().slice(0, 7), Number(row.count)]));
		const now = new Date();
		return Array.from({ length: 12 }, (_, index) => {
			const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
			const key = date.toISOString().slice(0, 7);
			return { month: date.toLocaleString('en', { month: 'long', timeZone: 'UTC' }), year: date.getUTCFullYear(), count: counts.get(key) ?? 0 };
		});
	}

	private userRow() {
		return this.prisma.$queryRaw<UserRow[]>`
			SELECT count(*)::bigint AS total,
				count(*) FILTER (WHERE source_updated_at >= now() - INTERVAL '30 days')::bigint AS "active30d",
				count(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days')::bigint AS "new30d",
				count(*) FILTER (WHERE roles @> ARRAY['ADMIN']::text[])::bigint AS admins,
				count(*) FILTER (WHERE login_method_count >= 2)::bigint AS "multiLoginUsers"
			FROM reporting.identity_user_projections
			WHERE tombstoned = FALSE AND deleted_at IS NULL`;
	}

	private crmRow() {
		return this.prisma.$queryRaw<CrmRow[]>`
			SELECT count(*) FILTER (WHERE status = 'ACTIVE' AND plan_code = 'PAID' AND effective_until > now())::bigint AS "activePaid",
				count(*) FILTER (WHERE status = 'ACTIVE' AND plan_code = 'TRIAL' AND effective_until > now())::bigint AS "activeTrial",
				count(*) FILTER (WHERE status = 'ACTIVE' AND effective_until BETWEEN now() AND now() + INTERVAL '7 days')::bigint AS "expiring7d",
				count(*) FILTER (WHERE status = 'ACTIVE' AND effective_until < now())::bigint AS "expiredActive"
			FROM reporting.crm_entitlement_projections WHERE tombstoned = FALSE`;
	}

	private revenueRow() {
		return this.prisma.$queryRaw<RevenueRow[]>`
			SELECT COALESCE(sum(amount_minor), 0)::bigint AS "totalMinor",
				COALESCE(sum(amount_minor) FILTER (WHERE paid_at >= now() - INTERVAL '30 days'), 0)::bigint AS "last30dMinor",
				COALESCE(sum(amount_minor) FILTER (WHERE paid_at >= date_trunc('month', now())), 0)::bigint AS "currentMonthMinor",
				count(*) FILTER (WHERE paid_at >= now() - INTERVAL '30 days')::bigint AS "paidOrders30d"
			FROM reporting.crm_order_facts WHERE tombstoned = FALSE`;
	}

	private usersView(row?: UserRow) {
		return {
			total: Number(row?.total ?? 0),
			active30d: Number(row?.active30d ?? 0),
			new30d: Number(row?.new30d ?? 0),
			admins: Number(row?.admins ?? 0),
			multiLoginUsers: Number(row?.multiLoginUsers ?? 0)
		};
	}
}
