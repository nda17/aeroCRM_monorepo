import clsx from 'clsx'
import type { HTMLAttributes, ReactNode } from 'react'

import styles from './StatusBadge.module.scss'

export type StatusBadgeTone =
	| 'neutral'
	| 'success'
	| 'warning'
	| 'danger'
	| 'info'
	| 'accent'

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
	tone?: StatusBadgeTone
	showDot?: boolean
	children: ReactNode
}

export const StatusBadge = ({
	tone = 'info',
	showDot = true,
	className,
	children,
	...props
}: StatusBadgeProps) => {
	return (
		<span
			className={clsx(styles.badge, styles[tone], className)}
			{...props}
		>
			{showDot ? <span className={styles.dot} aria-hidden="true" /> : null}
			{children}
		</span>
	)
}
