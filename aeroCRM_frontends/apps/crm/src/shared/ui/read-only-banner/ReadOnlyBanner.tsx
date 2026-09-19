import clsx from 'clsx'
import { useId } from 'react'
import type { ReactNode } from 'react'

import { AppIcon } from '../app-icon'
import styles from './ReadOnlyBanner.module.scss'

export type ReadOnlyBannerTone = 'info' | 'warning'

export interface ReadOnlyBannerProps {
	description: ReactNode
	title?: ReactNode
	action?: ReactNode
	tone?: ReadOnlyBannerTone
	className?: string
}

export const ReadOnlyBanner = ({
	title = 'Режим только для чтения',
	description,
	action,
	tone = 'info',
	className
}: ReadOnlyBannerProps) => {
	const titleId = useId()

	return (
		<aside
			className={clsx(styles.banner, styles[tone], className)}
			aria-labelledby={titleId}
		>
			<span className={styles.icon} aria-hidden="true">
				<AppIcon name="lock" size={20} />
			</span>
			<div className={styles.copy}>
				<div id={titleId} className={styles.title}>
					{title}
				</div>
				<div className={styles.description}>{description}</div>
			</div>
			{action ? <div className={styles.action}>{action}</div> : null}
		</aside>
	)
}
