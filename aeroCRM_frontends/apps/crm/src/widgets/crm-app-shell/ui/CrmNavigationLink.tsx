'use client'

import clsx from 'clsx'
import { useId } from 'react'
import Link from 'next/link'

import { AppIcon, useTooltip } from '@/shared/ui'
import type { CrmNavigationItem } from '../model/crm-navigation'
import styles from './CrmAppShell.module.scss'

export const CrmNavigationLink = ({
	item,
	isActive,
	enabled,
	disabledReason,
	unreadCount,
	onNavigate
}: {
	item: CrmNavigationItem
	isActive: boolean
	enabled: boolean
	disabledReason?: string
	unreadCount?: number | null
	onNavigate?: () => void
}) => {
	const badgeId = useId()
	const showBadge =
		unreadCount === null || (unreadCount !== undefined && unreadCount > 0)
	const countDescription =
		unreadCount === null
			? 'Количество непрочитанных уведомлений пока неизвестно.'
			: `Непрочитанных уведомлений: ${unreadCount}.`
	const { triggerProps, tooltip, close } = useTooltip<HTMLElement>(
		disabledReason ??
			`${item.description}${showBadge ? ` ${countDescription}` : ''}`,
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
				aria-describedby={
					[
						triggerProps['aria-describedby'],
						showBadge ? badgeId : undefined
					]
						.filter(Boolean)
						.join(' ') || undefined
				}
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
				{showBadge ? (
					<span
						className={clsx(
							styles.navigationBadge,
							unreadCount === null && styles.navigationBadgeUnknown
						)}
						aria-hidden="true"
					>
						{unreadCount === null
							? '…'
							: unreadCount! > 99
								? '99+'
								: unreadCount}
					</span>
				) : null}
			</Link>
			{showBadge ? (
				<span id={badgeId} className="sr-only">
					{countDescription}
				</span>
			) : null}
			{tooltip}
		</>
	)
}
