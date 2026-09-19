'use client'

import clsx from 'clsx'
import Link from 'next/link'

import { AppIcon, useTooltip } from '@/shared/ui'
import type { CrmNavigationItem } from '../model/crm-navigation'
import styles from './CrmAppShell.module.scss'

export const CrmNavigationLink = ({
	item,
	isActive,
	enabled,
	onNavigate
}: {
	item: CrmNavigationItem
	isActive: boolean
	enabled: boolean
	onNavigate?: () => void
}) => {
	const { triggerProps, tooltip, close } = useTooltip<HTMLAnchorElement>(
		item.description,
		enabled
	)
	return (
		<>
			<Link
				{...triggerProps}
				href={item.href}
				className={clsx(
					styles.navigationLink,
					isActive && styles.navigationLinkActive
				)}
				aria-current={isActive ? 'page' : undefined}
				onClick={event => {
					close()
					if (
						event.defaultPrevented ||
						event.button !== 0 ||
						event.metaKey ||
						event.ctrlKey ||
						event.shiftKey ||
						event.altKey
					)
						return
					onNavigate?.()
				}}
			>
				<span className={styles.navigationIcon}>
					<AppIcon name={item.icon} size={20} />
				</span>
				<span>{item.label}</span>
			</Link>
			{tooltip}
		</>
	)
}
