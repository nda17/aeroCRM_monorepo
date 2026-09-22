import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/crm-sales-client';

export const MAX_MINOR = 2_147_483_647;
export const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new BadRequestException('Некорректные данные');
	return value as Record<string, unknown>;
}
export function string(value: unknown, label: string, max: number): string {
	if (
		typeof value !== 'string' ||
		value.trim().length < 1 ||
		value.trim().length > max ||
		/[\x00-\x1f\x7f]/.test(value)
	)
		throw new BadRequestException(`Некорректное поле ${label}`);
	return value.trim();
}
export function multiline(value: unknown, label: string, max: number): string {
	if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
		throw new BadRequestException(`Некорректное поле ${label}`);
	return value.replace(/\r\n?/g, '\n').trim();
}
export function uuid(value: unknown, label: string): string {
	if (typeof value !== 'string' || !UUID_V4.test(value))
		throw new BadRequestException(`Некорректное поле ${label}`);
	return value;
}
export function minor(
	value: unknown,
	label: string,
	nullable = false
): number | null {
	if (nullable && (value === null || value === undefined || value === ''))
		return null;
	if (
		!Number.isInteger(value) ||
		(value as number) < 0 ||
		(value as number) > MAX_MINOR
	)
		throw new BadRequestException(
			`${label}: сумма должна быть от 0 до 21 474 836,47 ₽`
		);
	return value as number;
}
export function positiveMinor(value: unknown, label: string): number {
	const parsed = minor(value, label);
	if (!parsed)
		throw new BadRequestException(`${label}: сумма должна быть больше нуля`);
	return parsed;
}
export function quantityMilli(value: unknown): bigint {
	if (
		typeof value !== 'string' ||
		!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value)
	)
		throw new BadRequestException('Количество: до трёх знаков после запятой');
	const [whole, fraction = ''] = value.split('.');
	const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
	if (result <= 0n)
		throw new BadRequestException('Количество должно быть больше нуля');
	return result;
}
export function lineTotal(
	quantity: string,
	unitPriceMinor: number,
	discountMinor: number
): number {
	const gross =
		(quantityMilli(quantity) * BigInt(unitPriceMinor) + 500n) / 1000n;
	if (gross > BigInt(MAX_MINOR))
		throw new BadRequestException('Сумма строки превышает 21 474 836,47 ₽');
	if (BigInt(discountMinor) > gross)
		throw new BadRequestException('Скидка превышает сумму строки');
	return Number(gross - BigInt(discountMinor));
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(',')}}`;
	return JSON.stringify(value);
}
export function hash(value: unknown): string {
	return createHash('sha256').update(canonical(value)).digest('hex');
}
export async function lock(
	tx: Prisma.TransactionClient,
	key: string
): Promise<void> {
	await tx.$executeRaw(
		Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
	);
}
export function conflict(
	message = 'Данные изменились. Обновите страницу и повторите действие'
): never {
	throw new ConflictException(message);
}
export async function serializable<T>(run: () => Promise<T>): Promise<T> {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await run();
		} catch (error) {
			if (
				!error ||
				typeof error !== 'object' ||
				!('code' in error) ||
				error.code !== 'P2034'
			)
				throw error;
			if (attempt === 2)
				conflict(
					'Операция одновременно изменялась. Обновите данные и повторите'
				);
		}
	}
	return conflict();
}
