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
	disabledReason,
	onNavigate
}: {
	item: CrmNavigationItem
	isActive: boolean
	enabled: boolean
	disabledReason?: string
	onNavigate?: () => void
}) => {
	const { triggerProps, tooltip, close } = useTooltip<HTMLElement>(
		disabledReason ?? item.description,
		enabled
	)
	if (disabledReason)
		return (
			<>
				<button
					{...triggerProps}
					type="button"
					className={clsx(
						styles.navigationLink,
						styles.navigationLinkDisabled
					)}
					aria-disabled="true"
					aria-label={`${item.label}. ${disabledReason}`}
					title={disabledReason}
				>
					<span className={styles.navigationIcon}>
						<AppIcon name={item.icon} size={20} />
					</span>
					<span>{item.label}</span>
				</button>
				{tooltip}
			</>
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
