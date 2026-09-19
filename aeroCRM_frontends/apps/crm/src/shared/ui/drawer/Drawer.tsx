'use client'

import clsx from 'clsx'
import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode, RefObject } from 'react'

import { AppIcon } from '../app-icon'
import { useModalToastHost } from '../toast-provider/ToastProvider'
import styles from './Drawer.module.scss'

export type DrawerSide = 'left' | 'right'
export type DrawerSize = 'sm' | 'md' | 'lg'

export interface DrawerProps {
	isOpen: boolean
	onClose: () => void
	title: ReactNode
	description?: ReactNode
	side?: DrawerSide
	size?: DrawerSize
	children: ReactNode
	footer?: ReactNode
	closeLabel?: string
	initialFocusRef?: RefObject<HTMLElement | null>
	className?: string
}

let bodyLockDepth = 0
const ROOT_SCROLL_LOCK_CLASS = 'crm-drawer-scroll-lock'

const acquireBodyLock = () => {
	if (bodyLockDepth === 0) {
		document.documentElement.classList.add(ROOT_SCROLL_LOCK_CLASS)
	}

	bodyLockDepth += 1
}

const releaseBodyLock = () => {
	bodyLockDepth = Math.max(0, bodyLockDepth - 1)

	if (bodyLockDepth === 0) {
		document.documentElement.classList.remove(ROOT_SCROLL_LOCK_CLASS)
	}
}

export const Drawer = ({
	isOpen,
	onClose,
	title,
	description,
	side = 'right',
	size = 'md',
	children,
	footer,
	closeLabel = 'Закрыть панель',
	initialFocusRef,
	className
}: DrawerProps) => {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const closeButtonRef = useRef<HTMLButtonElement>(null)
	const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)
	const titleId = useId()
	const descriptionId = useId()
	const registerToastHost = useModalToastHost()

	useEffect(() => {
		const dialog = dialogRef.current

		if (!dialog || !isOpen) {
			if (dialog?.open) dialog.close()
			return
		}

		previouslyFocusedElementRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null

		if (!dialog.open) dialog.showModal()
		acquireBodyLock()
		const releaseToastHost = registerToastHost(dialog)

		const focusFrame = window.requestAnimationFrame(() => {
			const focusTarget =
				initialFocusRef?.current ?? closeButtonRef.current
			focusTarget?.focus()
		})

		return () => {
			window.cancelAnimationFrame(focusFrame)
			releaseToastHost()
			if (dialog.open) dialog.close()
			releaseBodyLock()

			const previouslyFocusedElement = previouslyFocusedElementRef.current
			if (previouslyFocusedElement?.isConnected) {
				previouslyFocusedElement.focus()
			}
		}
	}, [initialFocusRef, isOpen, registerToastHost])

	const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
		if (event.target === event.currentTarget) onClose()
	}

	return (
		<dialog
			ref={dialogRef}
			className={clsx(
				styles.dialog,
				styles[side],
				styles[size],
				className
			)}
			aria-labelledby={titleId}
			aria-describedby={description ? descriptionId : undefined}
			onCancel={event => {
				event.preventDefault()
				onClose()
			}}
			onClick={handleBackdropClick}
		>
			<div className={styles.panel}>
				<header className={styles.header}>
					<div className={styles.heading}>
						<h2 id={titleId} className={styles.title}>
							{title}
						</h2>
						{description ? (
							<div id={descriptionId} className={styles.description}>
								{description}
							</div>
						) : null}
					</div>
					<button
						ref={closeButtonRef}
						type="button"
						className={styles.closeButton}
						onClick={onClose}
						aria-label={closeLabel}
					>
						<AppIcon name="close" size={20} />
					</button>
				</header>
				<div className={styles.content}>{children}</div>
				{footer ? (
					<footer className={styles.footer}>{footer}</footer>
				) : null}
			</div>
		</dialog>
	)
}
