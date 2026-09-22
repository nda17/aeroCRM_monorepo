import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { CrmSalesPrismaService } from '../prisma/crm-sales-prisma.service';
import type { SalesAccess } from '../sales/sales-access';
import { salesScope } from '../sales/sales.service';
import {
	conflict,
	hash,
	lock,
	multiline,
	object,
	positiveMinor,
	serializable,
	string,
	uuid,
	MAX_MINOR
} from './commerce-core';

type Tx = Prisma.TransactionClient;
const options = {
	isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
	timeout: 15000,
	maxWait: 5000
} as const;
type Payment = Prisma.CommercePaymentGetPayload<object>;

@Injectable()
export class CommerceFinanceService {
	constructor(private readonly db: CrmSalesPrismaService) {}
	private require(access: SalesAccess, permission: string) {
		if (
			!access.permissions.includes(permission) ||
			(access.state === 'READ_ONLY' &&
				!['sales:read', 'sales:analytics', 'sales:export'].includes(permission))
		)
			throw new ForbiddenException();
	}
	private async deal(
		tx: Tx,
		access: SalesAccess,
		id: string,
		mutation = false
	) {
		const deal = await tx.deal.findFirst({
			where: {
				AND: [
					salesScope(access),
					{ id, ...(mutation ? { archivedAt: null } : {}) }
				]
			}
		});
		if (!deal) throw new NotFoundException('Сделка не найдена или недоступна');
		return deal;
	}
	private async command<T>(
		access: SalesAccess,
		body: Record<string, unknown>,
		kind: string,
		target: string,
		work: (tx: Tx) => Promise<T>
	) {
		const commandId = uuid(body.commandId, 'commandId'),
			requestHash = hash({ kind, body, target });
		return serializable(() =>
			this.db.$transaction(async tx => {
				await lock(tx, `commerce:command:${commandId}`);
				const old = await tx.commerceCommand.findUnique({
					where: { commandId }
				});
				if (old) {
					if (
						old.workspaceId !== access.workspaceId ||
						old.actorSubject !== access.subject ||
						old.kind !== kind ||
						old.requestHash !== requestHash
					)
						conflict('Команда уже использована с другими данными');
					await this.deal(tx, access, target.split(':')[0]);
					return old.result as T;
				}
				const result = await work(tx);
				await tx.commerceCommand.create({
					data: {
						commandId,
						workspaceId: access.workspaceId,
						actorSubject: access.subject,
						kind,
						requestHash,
						result: result as Prisma.InputJsonValue
					}
				});
				return result;
			}, options)
		);
	}
	private paymentView(row: Payment) {
		return {
			id: row.id,
			kind: row.kind,
			amountMinor: row.amountMinor,
			occurredAt: row.occurredAt.toISOString(),
			comment: row.comment,
			correctsPaymentId: row.correctsPaymentId,
			createdBySubject: row.createdBySubject,
			createdAt: row.createdAt.toISOString()
		};
	}
	private effective(rows: Payment[]) {
		const corrected = new Set(
			rows.filter(p => p.kind.startsWith('VOID_')).map(p => p.correctsPaymentId)
		);
		return rows.filter(
			p => !p.kind.startsWith('VOID_') && !corrected.has(p.id)
		);
	}
	private net(rows: Payment[]) {
		return this.effective(rows).reduce(
			(sum, p) => sum + (p.kind === 'RECEIPT' ? p.amountMinor : -p.amountMinor),
			0
		);
	}
	private assertLedger(rows: Payment[]) {
		let running = 0;
		for (const p of this.effective(rows).sort(
			(a, b) =>
				a.occurredAt.getTime() - b.occurredAt.getTime() ||
				a.createdAt.getTime() - b.createdAt.getTime() ||
				a.id.localeCompare(b.id)
		)) {
			running += p.kind === 'RECEIPT' ? p.amountMinor : -p.amountMinor;
			if (running < 0)
				throw new BadRequestException(
					'Возврат не может предшествовать достаточному поступлению'
				);
			if (running > MAX_MINOR)
				throw new BadRequestException('Оплаченная сумма превышает предел');
		}
	}
	private paymentsView(
		deal: { id: string; version: number; amountMinor: number },
		rows: Payment[]
	) {
		const netPaidMinor = this.net(rows);
		return {
			schemaVersion: 1,
			dealId: deal.id,
			dealVersion: deal.version,
			amountMinor: deal.amountMinor,
			netPaidMinor,
			balanceMinor: Math.max(deal.amountMinor - netPaidMinor, 0),
			overpaidMinor: Math.max(netPaidMinor - deal.amountMinor, 0),
			items: rows.map(p => this.paymentView(p))
		};
	}
	async payments(access: SalesAccess, id: string) {
		this.require(access, 'sales:read');
		return this.db.$transaction(
			async tx => {
				const deal = await this.deal(tx, access, id);
				const rows = await tx.commercePayment.findMany({
					where: { dealId: id, workspaceId: access.workspaceId },
					orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
				});
				return this.paymentsView(deal, rows);
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}
	async addPayment(access: SalesAccess, id: string, input: unknown) {
		this.require(access, 'sales:write');
		const body = object(input),
			kind = body.kind,
			amount = positiveMinor(body.amountMinor, 'Сумма');
		if (kind !== 'RECEIPT' && kind !== 'REFUND')
			throw new BadRequestException('Выберите поступление или возврат');
		const occurredAt = new Date(String(body.occurredAt));
		if (
			!Number.isFinite(occurredAt.getTime()) ||
			occurredAt.toISOString() !== body.occurredAt
		)
			throw new BadRequestException('Некорректная дата операции');
		const comment =
			body.comment === undefined
				? ''
				: multiline(body.comment, 'comment', 1000);
		return this.command(access, body, 'PAYMENT_ADD', id, async tx => {
			await lock(tx, `commerce:deal:${id}`);
			const deal = await this.deal(tx, access, id, true);
			const before = await tx.commercePayment.findMany({
				where: { dealId: id, workspaceId: access.workspaceId },
				orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
			});
			const next = this.net(before) + (kind === 'RECEIPT' ? amount : -amount);
			if (next < 0)
				throw new BadRequestException(
					'Возврат превышает чистую полученную сумму'
				);
			if (next > MAX_MINOR)
				throw new BadRequestException(
					'Оплаченная сумма превышает 21 474 836,47 ₽'
				);
			const row = await tx.commercePayment.create({
				data: {
					workspaceId: access.workspaceId,
					dealId: id,
					kind,
					amountMinor: amount,
					occurredAt,
					comment,
					createdBySubject: access.subject
				}
			});
			this.assertLedger([...before, row]);
			await tx.deal.update({
				where: { id },
				data: { version: { increment: 1 } }
			});
			await tx.commerceEvent.create({
				data: {
					workspaceId: access.workspaceId,
					dealId: id,
					actorSubject: access.subject,
					kind: 'PAYMENT_ADDED',
					details: {
						payment: this.paymentView(row),
						beforeNetMinor: this.net(before),
						afterNetMinor: next
					}
				}
			});
			return this.paymentsView(
				{ ...deal, version: deal.version + 1 },
				[...before, row].sort(
					(a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
				)
			);
		});
	}
	async correctPayment(
		access: SalesAccess,
		id: string,
		paymentId: string,
		input: unknown
	) {
		this.require(access, 'sales:write');
		const body = object(input);
		return this.command(
			access,
			body,
			'PAYMENT_CORRECT',
			id + ':' + paymentId,
			async tx => {
				await lock(tx, `commerce:deal:${id}`);
				const deal = await this.deal(tx, access, id, true);
				const old = await tx.commercePayment.findFirst({
					where: { id: paymentId, dealId: id, workspaceId: access.workspaceId }
				});
				if (!old || old.kind.startsWith('VOID_'))
					throw new NotFoundException('Операция не найдена');
				if (
					await tx.commercePayment.findFirst({
						where: { correctsPaymentId: paymentId, dealId: id }
					})
				)
					conflict('Операция уже исправлена');
				const rows = await tx.commercePayment.findMany({
					where: { dealId: id, workspaceId: access.workspaceId }
				});
				const replacement = object(body.replacement),
					kind = replacement.kind;
				if (kind !== 'RECEIPT' && kind !== 'REFUND')
					throw new BadRequestException('Выберите поступление или возврат');
				const amount = positiveMinor(replacement.amountMinor, 'Сумма');
				const occurredAt = new Date(String(replacement.occurredAt));
				if (
					!Number.isFinite(occurredAt.getTime()) ||
					occurredAt.toISOString() !== replacement.occurredAt
				)
					throw new BadRequestException('Некорректная дата');
				const comment =
					replacement.comment === undefined
						? ''
						: multiline(replacement.comment, 'comment', 1000);
				const delta =
					(old.kind === 'RECEIPT' ? -old.amountMinor : old.amountMinor) +
					(kind === 'RECEIPT' ? amount : -amount);
				const net = this.net(rows) + delta;
				if (net < 0)
					throw new BadRequestException(
						'Исправление создаёт возврат сверх полученной суммы'
					);
				if (net > MAX_MINOR)
					throw new BadRequestException('Оплаченная сумма превышает предел');
				const voided = await tx.commercePayment.create({
					data: {
						workspaceId: access.workspaceId,
						dealId: id,
						kind: old.kind === 'RECEIPT' ? 'VOID_RECEIPT' : 'VOID_REFUND',
						amountMinor: old.amountMinor,
						occurredAt: new Date(),
						comment: `Исправление ${old.id}`,
						correctsPaymentId: old.id,
						createdBySubject: access.subject
					}
				});
				const fresh = await tx.commercePayment.create({
					data: {
						workspaceId: access.workspaceId,
						dealId: id,
						kind,
						amountMinor: amount,
						occurredAt,
						comment,
						createdBySubject: access.subject
					}
				});
				this.assertLedger([...rows, voided, fresh]);
				await tx.deal.update({
					where: { id },
					data: { version: { increment: 1 } }
				});
				await tx.commerceEvent.create({
					data: {
						workspaceId: access.workspaceId,
						dealId: id,
						actorSubject: access.subject,
						kind: 'PAYMENT_CORRECTED',
						details: {
							before: this.paymentView(old),
							void: this.paymentView(voided),
							after: this.paymentView(fresh)
						}
					}
				});
				return this.paymentsView(
					{ ...deal, version: deal.version + 1 },
					[...rows, voided, fresh].sort(
						(a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
					)
				);
			}
		);
	}
	private quoteView(q: Prisma.CommerceQuoteGetPayload<object>) {
		return {
			id: q.id,
			dealId: q.dealId,
			version: q.version,
			snapshot: q.snapshot,
			createdBySubject: q.createdBySubject,
			createdAt: q.createdAt.toISOString()
		};
	}
	async quotes(access: SalesAccess, id: string) {
		this.require(access, 'sales:read');
		await this.deal(this.db, access, id);
		const rows = await this.db.commerceQuote.findMany({
			where: { dealId: id, workspaceId: access.workspaceId },
			orderBy: { version: 'desc' }
		});
		return {
			schemaVersion: 1,
			dealId: id,
			items: rows.map(q => this.quoteView(q))
		};
	}
	async createQuote(access: SalesAccess, id: string, input: unknown) {
		this.require(access, 'sales:write');
		const body = object(input);
		return this.command(access, body, 'QUOTE_CREATE', id, async tx => {
			await lock(tx, `commerce:deal:${id}`);
			const deal = await this.deal(tx, access, id, true);
			const lines = await tx.commerceDealLine.findMany({
				where: { dealId: id, workspaceId: access.workspaceId },
				orderBy: { position: 'asc' }
			});
			if (!lines.length)
				throw new BadRequestException(
					'Добавьте позиции сделки перед формированием КП'
				);
			const seller = string(body.sellerName, 'sellerName', 200);
			const version =
				(await tx.commerceQuote.count({
					where: { dealId: id, workspaceId: access.workspaceId }
				})) + 1;
			const snapshot = {
				schemaVersion: 1,
				quoteVersion: version,
				dealVersion: deal.version,
				dealId: id,
				sellerName: seller,
				sellerDetails:
					body.sellerDetails === undefined
						? ''
						: multiline(body.sellerDetails, 'sellerDetails', 1000),
				customerName: deal.contactName,
				customerDetails:
					body.customerDetails === undefined
						? ''
						: multiline(body.customerDetails, 'customerDetails', 1000),
				dealTitle: deal.title,
				currency: 'RUB',
				amountMinor: deal.amountMinor,
				lines: lines.map(l => ({
					id: l.id,
					kind: l.kind,
					name: l.name,
					unit: l.unit,
					quantity: l.quantity.toFixed(3),
					unitPriceMinor: l.unitPriceMinor,
					discountMinor: l.discountMinor,
					totalMinor: l.totalMinor
				}))
			};
			const quote = await tx.commerceQuote.create({
				data: {
					workspaceId: access.workspaceId,
					dealId: id,
					version,
					snapshot,
					createdBySubject: access.subject
				}
			});
			await tx.commerceEvent.create({
				data: {
					workspaceId: access.workspaceId,
					dealId: id,
					actorSubject: access.subject,
					kind: 'QUOTE_CREATED',
					details: { quoteId: quote.id, version }
				}
			});
			return { schemaVersion: 1, quote: this.quoteView(quote) };
		});
	}
	async quoteHtml(access: SalesAccess, id: string, quoteId: string) {
		this.require(access, 'sales:read');
		await this.deal(this.db, access, id);
		const quote = await this.db.commerceQuote.findFirst({
			where: { id: quoteId, dealId: id, workspaceId: access.workspaceId }
		});
		if (!quote) throw new NotFoundException('КП не найдено');
		const s = quote.snapshot as Record<string, unknown>;
		const escape = (v: unknown) =>
			String(v ?? '').replace(
				/[&<>"']/g,
				c =>
					({
						'&': '&amp;',
						'<': '&lt;',
						'>': '&gt;',
						'"': '&quot;',
						"'": '&#39;'
					})[c]!
			);
		const rub = (v: unknown) => (Number(v) / 100).toFixed(2) + ' ₽';
		const lines = Array.isArray(s.lines)
			? (s.lines as Record<string, unknown>[])
			: [];
		const rows = lines
			.map(
				(l, i) =>
					`<tr><td>${i + 1}</td><td>${escape(l.name)}</td><td>${escape(l.kind === 'SERVICE' ? 'Услуга' : 'Товар')}</td><td>${escape(l.quantity)} ${escape(l.unit)}</td><td>${escape(rub(l.unitPriceMinor))}</td><td>${escape(rub(l.discountMinor))}</td><td>${escape(rub(l.totalMinor))}</td></tr>`
			)
			.join('');
		return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Коммерческое предложение № ${quote.version}</title><style>body{font:16px Arial,sans-serif;max-width:900px;margin:40px auto;color:#18243a}h1{font-size:26px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccd3dd;padding:9px;text-align:left}tfoot{font-weight:bold}.meta{margin:20px 0;line-height:1.6;white-space:pre-line}@media print{body{margin:0}}</style><h1>Коммерческое предложение № ${quote.version}</h1><div class="meta">Продавец: ${escape(s.sellerName)}<br>${escape(s.sellerDetails)}<br>Клиент: ${escape(s.customerName)}<br>${escape(s.customerDetails)}<br>Сделка: ${escape(s.dealTitle)}<br>Дата: ${quote.createdAt.toLocaleDateString('ru-RU', { timeZone: 'UTC' })}</div><table><thead><tr><th>№</th><th>Позиция</th><th>Тип</th><th>Количество</th><th>Цена</th><th>Скидка</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="6">Итого</td><td>${escape(rub(s.amountMinor))}</td></tr></tfoot></table></html>`;
	}
	async analytics(access: SalesAccess, query: Record<string, unknown>) {
		this.require(access, 'sales:analytics');
		const from = new Date(String(query.from)),
			to = new Date(String(query.to));
		if (
			!Number.isFinite(from.getTime()) ||
			!Number.isFinite(to.getTime()) ||
			from >= to ||
			to.getTime() - from.getTime() > 366 * 86400000
		)
			throw new BadRequestException('Укажите период до 366 дней');
		const pipelineId = query.pipelineId
			? uuid(query.pipelineId, 'pipelineId')
			: undefined;
		return this.db.$transaction(
			async tx => {
				const deals = await tx.deal.findMany({
					where: {
						AND: [salesScope(access), ...(pipelineId ? [{ pipelineId }] : [])]
					},
					select: {
						id: true,
						amountMinor: true,
						createdAt: true,
						archivedAt: true
					}
				});
				const ids = deals.map(d => d.id);
				const allPayments = ids.length
					? await tx.commercePayment.findMany({
							where: { workspaceId: access.workspaceId, dealId: { in: ids } }
						})
					: [];
				const payments = this.effective(allPayments).filter(
					p => p.occurredAt >= from && p.occurredAt < to
				);
				const dealValueMinor = deals
					.filter(d => !d.archivedAt && d.createdAt >= from && d.createdAt < to)
					.reduce((s, d) => s + BigInt(d.amountMinor), 0n);
				const receiptsMinor = payments
					.filter(p => p.kind === 'RECEIPT')
					.reduce((s, p) => s + BigInt(p.amountMinor), 0n);
				const refundsMinor = payments
					.filter(p => p.kind === 'REFUND')
					.reduce((s, p) => s + BigInt(p.amountMinor), 0n);
				return {
					schemaVersion: 1,
					currency: 'RUB',
					from: from.toISOString(),
					to: to.toISOString(),
					pipelineId: pipelineId || null,
					dealValueMinor: dealValueMinor.toString(),
					receiptsMinor: receiptsMinor.toString(),
					refundsMinor: refundsMinor.toString(),
					netPaidMinor: (receiptsMinor - refundsMinor).toString()
				};
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
		);
	}
	async history(access: SalesAccess, query: Record<string, unknown>) {
		this.require(access, 'sales:read');
		const dealId = query.dealId ? uuid(query.dealId, 'dealId') : undefined;
		if (dealId) await this.deal(this.db, access, dealId);
		const rows = await this.db.commerceEvent.findMany({
			where: {
				workspaceId: access.workspaceId,
				...(dealId ? { dealId } : { dealId: null })
			},
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: 100
		});
		return {
			schemaVersion: 1,
			items: rows.map(r => ({
				id: r.id,
				kind: r.kind,
				dealId: r.dealId,
				actorSubject: r.actorSubject,
				details: r.details,
				createdAt: r.createdAt.toISOString()
			}))
		};
	}
	async exportDetail(access: SalesAccess, format: string) {
		this.require(access, 'sales:export');
		if (access.role !== 'OWNER' || !access.permissions.includes('sales:export'))
			throw new BadRequestException('Экспорт доступен владельцу');
		if (format !== 'json' && format !== 'csv')
			throw new BadRequestException('Укажите json или csv');
		const bounded = (body: string) => {
			if (Buffer.byteLength(body, 'utf8') > 16 * 1024 * 1024)
				throw new BadRequestException('Детальный экспорт превышает 16 МиБ');
			return body;
		};
		return this.db.$transaction(
			async tx => {
				const catalog = await tx.commerceCatalogItem.findMany({
					where: { workspaceId: access.workspaceId },
					orderBy: { id: 'asc' },
					take: 10001
				});
				if (catalog.length > 10000)
					throw new BadRequestException(
						'Экспорт превышает 10 000 позиций каталога'
					);
				const deals = await tx.deal.findMany({
					where: salesScope(access),
					select: {
						id: true,
						title: true,
						amountMinor: true,
						amountMode: true,
						createdAt: true
					},
					orderBy: { id: 'asc' },
					take: 10001
				});
				if (deals.length > 10000)
					throw new BadRequestException('Экспорт превышает 10 000 сделок');
				const ids = deals.map(d => d.id);
				const lines = ids.length
					? await tx.commerceDealLine.findMany({
							where: { workspaceId: access.workspaceId, dealId: { in: ids } },
							orderBy: [{ dealId: 'asc' }, { position: 'asc' }],
							take: 50001
						})
					: [];
				const payments = ids.length
					? await tx.commercePayment.findMany({
							where: { workspaceId: access.workspaceId, dealId: { in: ids } },
							orderBy: [
								{ dealId: 'asc' },
								{ occurredAt: 'asc' },
								{ id: 'asc' }
							],
							take: 50001
						})
					: [];
				if (catalog.length + lines.length + payments.length > 50000)
					throw new BadRequestException('Детальный экспорт слишком велик');
				const payload = {
					schemaVersion: 1,
					workspaceId: access.workspaceId,
					createdAt: new Date().toISOString(),
					catalog: catalog.map(item => ({
						id: item.id,
						code: item.code,
						kind: item.kind,
						name: item.name,
						unit: item.unit,
						basePriceMinor: item.basePriceMinor,
						version: item.version,
						archivedAt: item.archivedAt?.toISOString() || null
					})),
					deals: deals.map(d => ({
						...d,
						createdAt: d.createdAt.toISOString()
					})),
					lines: lines.map(l => ({ ...this.lineExport(l) })),
					payments: payments.map(p => ({
						...this.paymentView(p),
						dealId: p.dealId
					}))
				};
				if (format === 'json')
					return {
						contentType: 'application/json; charset=utf-8',
						filename: 'aerocrm-commerce.json',
						body: bounded(JSON.stringify(payload))
					};
				const escape = (value: unknown) => {
					const raw = String(value ?? '');
					const safe = /^[\s\x00-\x1f]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
					return `"${safe.replace(/"/g, '""')}"`;
				};
				const csv = [
					[
						'kind',
						'dealId',
						'id',
						'code',
						'name',
						'type',
						'quantity',
						'unit',
						'unitPriceMinor',
						'discountMinor',
						'amountMinor',
						'basePriceMinor',
						'archivedAt',
						'occurredAt',
						'comment',
						'correctsPaymentId',
						'createdBySubject'
					]
						.map(escape)
						.join(',')
				];
				for (const item of catalog)
					csv.push(
						[
							'CATALOG',
							'',
							item.id,
							item.code,
							item.name,
							item.kind,
							'',
							item.unit,
							'',
							'',
							'',
							item.basePriceMinor,
							item.archivedAt?.toISOString() || '',
							'',
							'',
							'',
							''
						]
							.map(escape)
							.join(',')
					);
				for (const l of lines)
					csv.push(
						[
							'LINE',
							l.dealId,
							l.id,
							'',
							l.name,
							l.kind,
							l.quantity.toFixed(3),
							l.unit,
							l.unitPriceMinor,
							l.discountMinor,
							l.totalMinor,
							'',
							'',
							'',
							'',
							'',
							''
						]
							.map(escape)
							.join(',')
					);
				for (const p of payments)
					csv.push(
						[
							'PAYMENT',
							p.dealId,
							p.id,
							'',
							'',
							p.kind,
							'',
							'',
							'',
							'',
							p.amountMinor,
							'',
							'',
							p.occurredAt.toISOString(),
							p.comment,
							p.correctsPaymentId,
							p.createdBySubject
						]
							.map(escape)
							.join(',')
					);
				return {
					contentType: 'text/csv; charset=utf-8',
					filename: 'aerocrm-commerce.csv',
					body: bounded('\uFEFF' + csv.join('\r\n') + '\r\n')
				};
			},
			{
				isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
				timeout: 5000,
				maxWait: 500
			}
		);
	}
	private lineExport(l: Prisma.CommerceDealLineGetPayload<object>) {
		return {
			id: l.id,
			dealId: l.dealId,
			catalogItemId: l.catalogItemId,
			kind: l.kind,
			name: l.name,
			unit: l.unit,
			quantity: l.quantity.toFixed(3),
			unitPriceMinor: l.unitPriceMinor,
			discountMinor: l.discountMinor,
			totalMinor: l.totalMinor
		};
	}
}
