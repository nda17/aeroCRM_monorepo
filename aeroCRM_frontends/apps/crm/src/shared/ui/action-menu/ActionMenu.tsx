'use client'

import { useRef, type ReactNode } from 'react'
import { AppIcon } from '../app-icon'
import styles from './ActionMenu.module.scss'

export const ActionMenu = ({
	children,
	label = 'Ещё',
	disabled = false
}: {
	children: ReactNode
	label?: string
	disabled?: boolean
}) => {
	const ref = useRef<HTMLDetailsElement>(null)
	return (
		<details
			ref={ref}
			className={styles.menu}
			onBlur={event => {
				if (!event.currentTarget.contains(event.relatedTarget))
					event.currentTarget.open = false
			}}
			onKeyDown={event => {
				const dialog =
					event.target instanceof Element
						? event.target.closest('dialog')
						: null
				if (dialog && !dialog.contains(event.currentTarget)) return
				if (event.key === 'Escape' && ref.current?.open) {
					event.preventDefault()
					event.stopPropagation()
					ref.current.open = false
					ref.current.querySelector('summary')?.focus()
				}
			}}
		>
			<summary
				className={styles.trigger}
				aria-disabled={disabled || undefined}
				onClick={event => {
					if (disabled) event.preventDefault()
				}}
			>
				{label}
				<AppIcon name="chevronDown" size={16} />
			</summary>
			<div className={styles.panel}>{children}</div>
		</details>
	)
}
