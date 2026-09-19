import clsx from 'clsx'
import type { ReactNode } from 'react'

import styles from './PageHeader.module.scss'

export interface PageHeaderProps {
	title: ReactNode
	description?: ReactNode
	eyebrow?: ReactNode
	actions?: ReactNode
	headingLevel?: 1 | 2
	className?: string
}

export const PageHeader = ({
	title,
	description,
	eyebrow,
	actions,
	headingLevel = 1,
	className
}: PageHeaderProps) => {
	const Heading = headingLevel === 1 ? 'h1' : 'h2'

	return (
		<header className={clsx(styles.header, className)}>
			<div className={styles.copy}>
				{eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
				<Heading className={styles.title}>{title}</Heading>
				{description ? (
					<div className={styles.description}>{description}</div>
				) : null}
			</div>
			{actions ? <div className={styles.actions}>{actions}</div> : null}
		</header>
	)
}
