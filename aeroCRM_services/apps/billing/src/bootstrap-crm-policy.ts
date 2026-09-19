import { PrismaClient } from '@prisma/billing-client';

function minor(name: string, required = true): number | null {
	const value = process.env[name]?.trim();
	if (!value && !required) return null;
	if (!value || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) {
		throw new Error(`${name} must be a positive ruble amount`);
	}
	const [rubles, kopecks = ''] = value.split('.');
	const amount = Number(rubles) * 100 + Number(kopecks.padEnd(2, '0'));
	if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) {
		throw new Error(`${name} is outside the supported range`);
	}
	return amount;
}

function count(name: string): number {
	const value = process.env[name]?.trim();
	if (!value || !/^\d{1,5}$/.test(value)) throw new Error(`${name} is invalid`);
	return Number(value);
}

async function bootstrapCrmPolicy() {
	const monthlyPriceMinor = minor('CRM_MONTHLY_PRICE_RUB')!;
	const yearlyConfigured = minor('CRM_YEARLY_PRICE_RUB', false);
	const yearlyPriceMinor = yearlyConfigured ?? Math.round(monthlyPriceMinor * 108 / 10);
	if (yearlyPriceMinor !== Math.round(monthlyPriceMinor * 108 / 10)) {
		throw new Error('CRM yearly base price must include exactly 10% discount');
	}
	const additionalSeatMonthlyPriceMinor = minor('CRM_ADDITIONAL_SEAT_MONTHLY_PRICE_RUB')!;
	const additionalSeatYearlyPriceMinor = minor('CRM_ADDITIONAL_SEAT_YEARLY_PRICE_RUB')!;
	const trialDays = count('CRM_TRIAL_DAYS');
	const trialSeatLimit = count('CRM_TRIAL_SEAT_LIMIT');
	const includedSeats = count('CRM_INCLUDED_SEATS');
	if (trialDays !== 10 || includedSeats < 2 || includedSeats > 10_000 || trialSeatLimit < 2 || trialSeatLimit > 10_000) {
		throw new Error('CRM policy lifecycle or seat count is invalid');
	}
	const prisma = new PrismaClient();
	try {
		const current = await prisma.crmCommercialPolicy.findFirst({ orderBy: { version: 'desc' } });
		if (current) {
			if (
				current.monthlyPriceMinor !== monthlyPriceMinor ||
				current.yearlyPriceMinor !== yearlyPriceMinor ||
				current.additionalSeatMonthlyPriceMinor !== additionalSeatMonthlyPriceMinor ||
				current.additionalSeatYearlyPriceMinor !== additionalSeatYearlyPriceMinor ||
				current.includedSeats !== includedSeats ||
				current.trialSeatLimit !== trialSeatLimit ||
				current.trialDays !== trialDays
			) throw new Error('Existing CRM policy differs from bootstrap values');
			return;
		}
		await prisma.crmCommercialPolicy.create({
			data: {
				version: 1,
				monthlyPriceMinor,
				yearlyPriceMinor,
				additionalSeatMonthlyPriceMinor,
				additionalSeatYearlyPriceMinor,
				includedSeats,
				trialSeatLimit,
				trialDays,
				graceDays: 3
			}
		});
	} finally {
		await prisma.$disconnect();
	}
}

void bootstrapCrmPolicy().catch(error => {
	console.error(error instanceof Error ? error.message : 'CRM policy bootstrap failed');
	process.exitCode = 1;
});
