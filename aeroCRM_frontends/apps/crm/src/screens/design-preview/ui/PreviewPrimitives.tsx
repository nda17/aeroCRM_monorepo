'use client'

import type { ReactNode } from 'react'
import { AppIcon } from '@/shared/ui/app-icon'
import styles from './DesignPreview.module.scss'

export function PreviewHeading({
	eyebrow,
	title,
	description,
	action
}: {
	eyebrow: string
	title: string
	description: string
	action?: ReactNode
}) {
	return (
		<div className={styles.pageHeading}>
			<div>
				<div className={styles.eyebrow}>{eyebrow}</div>
				<h1>{title}</h1>
				<p>{description}</p>
			</div>
			{action}
		</div>
	)
}

export function PreviewSearch({
	value,
	onChange,
	label = 'Поиск',
	placeholder = 'Поиск по названию'
}: {
	value: string
	onChange: (value: string) => void
	label?: string
	placeholder?: string
}) {
	return (
		<label className={styles.search}>
			<AppIcon name="search" size={17} />
			<input
				aria-label={label}
				value={value}
				onChange={event => onChange(event.target.value)}
				placeholder={placeholder}
			/>
			{value && (
				<button
					type="button"
					aria-label="Очистить поиск"
					onClick={() => onChange('')}
				>
					<AppIcon name="close" size={15} />
				</button>
			)}
		</label>
	)
}

export function PreviewEmpty({
	title = 'Ничего не найдено',
	description = 'Измените запрос или сбросьте фильтры.',
	reset
}: {
	title?: string
	description?: string
	reset?: () => void
}) {
	return (
		<div className={styles.empty}>
			<AppIcon name="search" size={28} />
			<h2>{title}</h2>
			<p>{description}</p>
			{reset && (
				<button className={styles.secondaryButton} onClick={reset}>
					Сбросить фильтры
				</button>
			)}
		</div>
	)
}

export const previewMoney = (value: number) =>
	`${new Intl.NumberFormat('ru-RU', {
		maximumFractionDigits: 2,
		minimumFractionDigits: Number.isInteger(value) ? 0 : 2
	}).format(value)} ₽`
export const previewInitials = (name: string) =>
	name
		.split(' ')
		.slice(0, 2)
		.map(part => part[0])
		.join('')
export const previewMatches = (query: string, ...values: string[]) =>
	values
		.join(' ')
		.toLocaleLowerCase('ru')
		.includes(query.trim().toLocaleLowerCase('ru'))

export function PreviewStatus({
	children,
	tone = 'neutral'
}: {
	children: ReactNode
	tone?: 'neutral' | 'success' | 'warning' | 'purple'
}) {
	return (
		<span className={styles.softBadge} data-tone={tone}>
			{children}
		</span>
	)
}
