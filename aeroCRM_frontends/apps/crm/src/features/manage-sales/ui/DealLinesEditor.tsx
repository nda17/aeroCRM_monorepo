'use client'

import { listCatalogItems } from '@/entities/sales/api/commerce.api'
import { Button, ScreenState, SelectField, TextField } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { CommerceContext } from '../model/use-commerce-command'
import {
	commerceFormError,
	moneyInput,
	parseMoneyInput,
	quantityInput
} from '../model/commerce-form'
import { salesMoney } from './DealDetailsDrawer'
import styles from './Commerce.module.scss'

export type DealLineRecord = {
	id: string
	catalogItemId: string | null
	kind: 'PRODUCT' | 'SERVICE'
	name: string
	unit: string
	quantity: string
	unitPriceMinor: number
	discountMinor: number
	totalMinor: number
}
export type DealLinesRecord = {
	dealId: string
	dealVersion: number
	mode: 'MANUAL' | 'LINES'
	amountMinor: number
	items: DealLineRecord[]
}
export type DealLineInput = {
	id: string
	catalogItemId: string | null
	kind: 'PRODUCT' | 'SERVICE'
	name: string
	unit: string
	quantity: string
	unitPriceMinor: number
	discountMinor: number
}
type Draft = Omit<DealLineInput, 'unitPriceMinor' | 'discountMinor'> & {
	price: string
	discount: string
}
const draftLine = (line: DealLineRecord): Draft => ({
	id: line.id,
	catalogItemId: line.catalogItemId,
	kind: line.kind,
	name: line.name,
	unit: line.unit,
	quantity: line.quantity,
	price: moneyInput(line.unitPriceMinor),
	discount: moneyInput(line.discountMinor)
})

export const DealLinesEditor = ({
	context,
	data,
	locked,
	onReplace,
	onSaveCatalog,
	onDirtyChange
}: {
	context: CommerceContext
	data: DealLinesRecord
	locked: boolean
	onReplace: (input: {
		expectedVersion: number
		lines: DealLineInput[]
		manualAmountMinor?: number
	}) => void
	onSaveCatalog: (
		lineId: string,
		expectedVersion: number,
		code?: string
	) => void
	onDirtyChange: (dirty: boolean) => void
}) => {
	const [rows, setRows] = useState<Draft[]>(() =>
		data.items.map(draftLine)
	)
	const [manual, setManual] = useState(moneyInput(data.amountMinor))
	const [error, setError] = useState<string | null>(null)
	const [search, setSearch] = useState('')
	const [searchInput, setSearchInput] = useState('')
	const [selected, setSelected] = useState('')
	const [catalogSave, setCatalogSave] = useState<string | null>(null)
	const [code, setCode] = useState('')
	const dirty =
		JSON.stringify(rows) !== JSON.stringify(data.items.map(draftLine)) ||
		(rows.length === 0 && manual !== moneyInput(data.amountMinor))
	useEffect(() => {
		onDirtyChange(dirty)
		return () => onDirtyChange(false)
	}, [dirty, onDirtyChange])
	const catalog = useQuery({
		queryKey: ['sales', 'catalog-picker', ...context.key, search],
		enabled: context.canRead,
		queryFn: () =>
			listCatalogItems(
				context.session!.accessToken,
				context.workspace.workspaceId,
				{ page: 1, pageSize: 100, search, includeArchived: false }
			),
		retry: false,
		gcTime: 0
	})
	const update = (id: string, patch: Partial<Draft>) =>
		setRows(current =>
			current.map(row => (row.id === id ? { ...row, ...patch } : row))
		)
	const addCatalog = () => {
		const item = catalog.data?.items.find(row => row.id === selected)
		if (!item || locked || rows.length >= 100) return
		setRows(current => [
			...current,
			{
				id: crypto.randomUUID(),
				catalogItemId: item.id,
				kind: item.kind,
				name: item.name,
				unit: item.unit,
				quantity: '1.000',
				price: moneyInput(item.basePriceMinor),
				discount: '0.00'
			}
		])
		setSelected('')
	}
	const save = () => {
		if (locked) return
		try {
			const lines = rows.map(row => ({
				id: row.id,
				catalogItemId: row.catalogItemId,
				kind: row.kind,
				name: row.name.trim(),
				unit: row.unit.trim(),
				quantity: quantityInput(row.quantity),
				unitPriceMinor: parseMoneyInput(row.price)!,
				discountMinor: parseMoneyInput(row.discount)!
			}))
			if (lines.some(line => !line.name || !line.unit))
				throw new Error('Укажите название и единицу каждой позиции.')
			setError(null)
			onReplace({
				expectedVersion: data.dealVersion,
				lines,
				...(lines.length === 0
					? { manualAmountMinor: parseMoneyInput(manual)! }
					: {})
			})
		} catch (cause) {
			setError(commerceFormError(cause))
		}
	}
	return (
		<section className={styles.section} aria-labelledby="deal-lines-title">
			<h3 id="deal-lines-title">Товары и услуги</h3>
			<p className={styles.muted}>
				Можно объединять товары и услуги, добавлять разовые строки или
				работать без каталога. Названия и цены сохраняются в самой сделке.
			</p>
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			{context.canWrite && (
				<div className={styles.item}>
					<form
						className={styles.grid}
						onSubmit={event => {
							event.preventDefault()
							setSearch(searchInput.trim())
							setSelected('')
						}}
					>
						<TextField
							label="Найти в каталоге"
							value={searchInput}
							maxLength={100}
							disabled={locked}
							onChange={event => setSearchInput(event.target.value)}
							placeholder="Название или код"
						/>
						<div className={styles.actions}>
							<Button type="submit" variant="secondary" disabled={locked}>
								Найти
							</Button>
						</div>
					</form>
					{catalog.isError ? (
						<ScreenState
							variant="error"
							compact
							description="Каталог недоступен. Разовую строку можно добавить вручную."
							action={
								<Button
									variant="secondary"
									onClick={() => void catalog.refetch()}
								>
									Повторить
								</Button>
							}
						/>
					) : (
						<SelectField
							label="Позиция каталога"
							value={selected}
							disabled={locked || catalog.isFetching}
							onChange={event => setSelected(event.target.value)}
						>
							<option value="">
								{catalog.isPending
									? 'Загрузка каталога…'
									: 'Выберите товар или услугу'}
							</option>
							{catalog.data?.items.map(item => (
								<option key={item.id} value={item.id}>
									{item.code} · {item.name} ·{' '}
									{item.basePriceMinor === null
										? 'цена не указана'
										: salesMoney(item.basePriceMinor)}
								</option>
							))}
						</SelectField>
					)}
					{catalog.data && catalog.data.total > 100 && (
						<p className={styles.muted}>
							Показаны первые 100 позиций. Уточните название или код.
						</p>
					)}
					<div className={styles.actions}>
						<Button
							variant="secondary"
							disabled={locked || !selected || rows.length >= 100}
							onClick={addCatalog}
						>
							Добавить из каталога
						</Button>
						<Button
							variant="secondary"
							disabled={locked || rows.length >= 100}
							onClick={() =>
								setRows(current => [
									...current,
									{
										id: crypto.randomUUID(),
										catalogItemId: null,
										kind: 'SERVICE',
										name: '',
										unit: 'шт.',
										quantity: '1.000',
										price: '',
										discount: '0.00'
									}
								])
							}
						>
							Добавить разовую строку
						</Button>
					</div>
				</div>
			)}
			{rows.length === 0 ? (
				<>
					<TextField
						label="Ручная сумма сделки, ₽"
						inputMode="decimal"
						value={manual}
						disabled={locked}
						onChange={event => setManual(event.target.value)}
					/>
					<p className={styles.muted}>
						{data.items.length
							? 'Удалены все позиции. После сохранения сумма станет указанной здесь; прежняя ручная сумма не восстановится.'
							: 'Пока в сделке нет позиций, её сумма указывается вручную.'}
					</p>
				</>
			) : (
				<ol className={styles.stack} aria-label="Состав сделки">
					{rows.map((row, index) => {
						const saved = data.items.find(item => item.id === row.id)
						const unchanged =
							saved &&
							JSON.stringify(draftLine(saved)) === JSON.stringify(row)
						return (
							<li className={styles.item} key={row.id}>
								<div className={styles.heading}>
									<strong>Позиция {index + 1}</strong>
									<span className={styles.muted}>
										{row.catalogItemId ? 'Из каталога' : 'Разовая строка'}
									</span>
								</div>
								<fieldset className={styles.fields} disabled={locked}>
									<TextField
										label="Название позиции"
										value={row.name}
										required
										maxLength={200}
										onChange={event =>
											update(row.id, { name: event.target.value })
										}
									/>
									<div className={styles.grid}>
										<SelectField
											label="Тип позиции"
											value={row.kind}
											onChange={event =>
												update(row.id, {
													kind: event.target.value as 'PRODUCT' | 'SERVICE'
												})
											}
										>
											<option value="PRODUCT">Товар</option>
											<option value="SERVICE">Услуга</option>
										</SelectField>
										<TextField
											label="Единица"
											value={row.unit}
											maxLength={32}
											required
											onChange={event =>
												update(row.id, { unit: event.target.value })
											}
										/>
										<TextField
											label="Количество"
											value={row.quantity}
											inputMode="decimal"
											required
											onChange={event =>
												update(row.id, { quantity: event.target.value })
											}
											hint="До 3 знаков после запятой"
										/>
										<TextField
											label="Цена за единицу, ₽"
											value={row.price}
											inputMode="decimal"
											required
											onChange={event =>
												update(row.id, { price: event.target.value })
											}
											hint={
												row.price === ''
													? 'Цена обязательна, пустое значение не означает ноль.'
													: undefined
											}
										/>
										<TextField
											label="Скидка строки, ₽"
											value={row.discount}
											inputMode="decimal"
											required
											onChange={event =>
												update(row.id, { discount: event.target.value })
											}
										/>
									</div>
								</fieldset>
								<p className={styles.muted}>
									Сумма строки:{' '}
									{unchanged
										? salesMoney(saved.totalMinor)
										: 'будет рассчитана при сохранении'}
								</p>
								{context.canWrite && (
									<div className={styles.actions}>
										<Button
											variant="ghost"
											size="sm"
											disabled={locked}
											onClick={() => {
												setRows(current =>
													current.filter(item => item.id !== row.id)
												)
												if (rows.length === 1) setManual('0.00')
											}}
										>
											Удалить строку
										</Button>
										{!row.catalogItemId && (
											<Button
												variant="secondary"
												size="sm"
												disabled={locked || dirty || !saved}
												disabledTooltip="Сначала сохраните состав сделки."
												onClick={() => {
													setCatalogSave(row.id)
													setCode('')
												}}
											>
												Сохранить в каталог
											</Button>
										)}
									</div>
								)}
								{catalogSave === row.id && (
									<form
										className={styles.item}
										onSubmit={event => {
											event.preventDefault()
											if (!locked && !dirty)
												onSaveCatalog(
													row.id,
													data.dealVersion,
													code.trim() || undefined
												)
										}}
									>
										<TextField
											label="Код новой позиции каталога"
											maxLength={100}
											value={code}
											disabled={locked}
											onChange={event => setCode(event.target.value)}
											hint="Необязательно: пустой код будет создан автоматически. Цена сделки сохранится."
										/>
										<div className={styles.actions}>
											<Button type="submit" disabled={locked || dirty}>
												Создать позицию в каталоге
											</Button>
											<Button
												variant="ghost"
												disabled={locked}
												onClick={() => setCatalogSave(null)}
											>
												Отмена
											</Button>
										</div>
									</form>
								)}
							</li>
						)
					})}
				</ol>
			)}
			<div className={styles.total}>
				<span>Сохранённая сумма сделки</span>
				<span>{salesMoney(data.amountMinor)}</span>
			</div>
			{dirty && (
				<p className={styles.notice}>
					Есть несохранённые изменения состава. Итог будет рассчитан после
					сохранения.
				</p>
			)}
			<p className={styles.muted}>
				Количество × цена округляется до копейки по каждой строке, затем
				вычитается скидка. Скидка не может превышать стоимость строки.
				Максимальная сумма сделки — 21 474 836,47 ₽.
			</p>
			{context.canWrite && (
				<div className={styles.actions}>
					<Button disabled={locked || !dirty} onClick={save}>
						Сохранить состав
					</Button>
					{dirty && (
						<Button
							variant="ghost"
							disabled={locked}
							onClick={() => {
								setRows(data.items.map(draftLine))
								setManual(moneyInput(data.amountMinor))
								setError(null)
								setCatalogSave(null)
							}}
						>
							Отменить изменения состава
						</Button>
					)}
				</div>
			)}
		</section>
	)
}
