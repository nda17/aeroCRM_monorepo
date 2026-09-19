import clsx from 'clsx'
import type { ReactNode } from 'react'

import { AppIcon } from '../app-icon'
import type { AppIconName } from '../app-icon'
import styles from './ScreenState.module.scss'

export type ScreenStateVariant =
	| 'loading'
	| 'empty'
	| 'error'
	| 'permission'

export interface ScreenStateProps {
	variant: ScreenStateVariant
	title?: ReactNode
	description?: ReactNode
	action?: ReactNode
	compact?: boolean
	className?: string
}

const defaultTitles: Record<ScreenStateVariant, string> = {
	loading: 'Загружаем данные',
	empty: 'Здесь пока ничего нет',
	error: 'Не удалось загрузить данные',
	permission: 'Недостаточно прав'
}

const stateIcons: Record<ScreenStateVariant, AppIconName> = {
	loading: 'refresh',
	empty: 'inbox',
	error: 'alert',
	permission: 'lock'
}

export const ScreenState = ({
	variant,
	title,
	description,
	action,
	compact = false,
	className
}: ScreenStateProps) => {
	const isError = variant === 'error'

	return (
		<section
			className={clsx(
				styles.state,
				styles[variant],
				compact && styles.compact,
				className
			)}
			role={isError ? 'alert' : undefined}
			aria-live={isError ? 'assertive' : undefined}
			aria-busy={variant === 'loading' || undefined}
		>
			<span
				className={clsx(
					styles.icon,
					variant === 'loading' && styles.loadingIcon
				)}
				aria-hidden="true"
			>
				<AppIcon name={stateIcons[variant]} size={24} />
			</span>
			<div
				className={styles.copy}
				role={isError ? undefined : 'status'}
				aria-live={isError ? undefined : 'polite'}
			>
				<h2 className={styles.title}>{title ?? defaultTitles[variant]}</h2>
				{description ? (
					<div className={styles.description}>{description}</div>
				) : null}
			</div>
			{variant === 'loading' ? (
				<div className={styles.skeleton} aria-hidden="true">
					<span />
					<span />
				</div>
			) : null}
			{action ? <div className={styles.action}>{action}</div> : null}
		</section>
	)
}
