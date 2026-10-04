'use client'

import clsx from 'clsx'
import { useDirtyFormGuard, DirtyFormScope } from '@/shared/lib/dirty-form'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
	CSSProperties,
	KeyboardEvent,
	MouseEvent,
	PointerEvent,
	ReactNode,
	RefObject
} from 'react'

import { AppIcon } from '../app-icon'
import { useModalToastHost } from '../toast-provider/ToastProvider'
import styles from './Drawer.module.scss'

export type DrawerSide = 'left' | 'right'
export type DrawerSize = 'sm' | 'md' | 'lg'

export interface DrawerProps {
	isOpen: boolean
	dirtyFormIds?: readonly string[]
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
const PRESET_WIDTH: Record<DrawerSize, number> = {
	sm: 384,
	md: 512,
	lg: 672
}
const MIN_WIDTH: Record<DrawerSize, number> = { sm: 384, md: 480, lg: 480 }
const DESKTOP_MIN_WIDTH = 640

type ResizeGesture = {
	pointerId: number
	startX: number
	startWidth: number
	side: DrawerSide
	handle: HTMLDivElement
}

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
	dirtyFormIds,
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
	const guard = useDirtyFormGuard()
	const [fullscreen, setFullscreen] = useState(false)
	const [customWidth, setCustomWidth] = useState<number | null>(null)
	const [viewportWidth, setViewportWidth] = useState(0)
	const [resizing, setResizing] = useState(false)
	const resizeRef = useRef<ResizeGesture | null>(null)
	const suppressClickRef = useRef(false)
	const resizable =
		isOpen && !fullscreen && viewportWidth >= DESKTOP_MIN_WIDTH
	const minWidth = MIN_WIDTH[size]
	const maxWidth = Math.max(
		minWidth,
		viewportWidth ? viewportWidth - 24 : PRESET_WIDTH[size]
	)
	const clampWidth = (value: number) =>
		Math.min(maxWidth, Math.max(minWidth, value))
	const width = clampWidth(customWidth ?? PRESET_WIDTH[size])
	const finishResize = useCallback((cancel = false) => {
		const gesture = resizeRef.current
		if (!gesture) return
		resizeRef.current = null
		if (cancel) setCustomWidth(gesture.startWidth)
		setResizing(false)
		if (gesture.handle.hasPointerCapture?.(gesture.pointerId))
			gesture.handle.releasePointerCapture(gesture.pointerId)
	}, [])
	const scopeId = useId()
	const close = () =>
		guard.confirmDiscard(onClose, [scopeId, ...(dirtyFormIds ?? [])])
	const dialogRef = useRef<HTMLDialogElement>(null)
	const closeButtonRef = useRef<HTMLButtonElement>(null)
	const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)
	const titleId = useId()
	const descriptionId = useId()
	const panelId = useId()
	const registerToastHost = useModalToastHost()

	useEffect(() => {
		const measure = () => {
			setViewportWidth(window.innerWidth)
			if (window.innerWidth < DESKTOP_MIN_WIDTH) finishResize(true)
		}
		const cancel = () => finishResize(true)
		measure()
		window.addEventListener('resize', measure)
		window.addEventListener('blur', cancel)
		return () => {
			window.removeEventListener('resize', measure)
			window.removeEventListener('blur', cancel)
			finishResize(true)
		}
	}, [finishResize])

	useEffect(() => {
		if (!resizable) finishResize(true)
	}, [finishResize, resizable])

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
		if (event.target !== event.currentTarget) return
		if (suppressClickRef.current) {
			event.preventDefault()
			event.stopPropagation()
			suppressClickRef.current = false
			return
		}
		close()
	}
	const startResize = (event: PointerEvent<HTMLDivElement>) => {
		if (
			!resizable ||
			resizeRef.current ||
			event.button !== 0 ||
			!event.isPrimary
		)
			return
		event.preventDefault()
		event.stopPropagation()
		event.currentTarget.focus()
		const startWidth = clampWidth(
			dialogRef.current?.getBoundingClientRect().width || width
		)
		event.currentTarget.setPointerCapture(event.pointerId)
		resizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth,
			side,
			handle: event.currentTarget
		}
		suppressClickRef.current = true
		setResizing(true)
	}
	const moveResize = (event: PointerEvent<HTMLDivElement>) => {
		const gesture = resizeRef.current
		if (!gesture || gesture.pointerId !== event.pointerId) return
		event.preventDefault()
		const delta = event.clientX - gesture.startX
		setCustomWidth(
			clampWidth(
				gesture.startWidth + (gesture.side === 'left' ? delta : -delta)
			)
		)
	}
	const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!resizable || resizeRef.current) return
		let next: number
		if (event.key === 'Home') next = minWidth
		else if (event.key === 'End') next = maxWidth
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			const direction = event.key === 'ArrowRight' ? 1 : -1
			next =
				width +
				direction * (side === 'left' ? 1 : -1) * (event.shiftKey ? 64 : 16)
		} else return
		event.preventDefault()
		event.stopPropagation()
		setCustomWidth(clampWidth(next))
	}

	return (
		<dialog
			ref={dialogRef}
			className={clsx(
				styles.dialog,
				styles[side],
				styles[size],
				fullscreen && styles.fullscreen,
				resizing && styles.resizing,
				className
			)}
			style={{ '--drawer-width': `${width}px` } as CSSProperties}
			aria-labelledby={titleId}
			aria-describedby={description ? descriptionId : undefined}
			onCancel={event => {
				if (event.target !== event.currentTarget) return
				event.preventDefault()
				if (resizeRef.current) finishResize(true)
				else close()
			}}
			onKeyDownCapture={event => {
				if (event.key === 'Escape' && resizeRef.current) {
					event.preventDefault()
					event.stopPropagation()
					finishResize(true)
				}
			}}
			onPointerDownCapture={() => {
				if (!resizeRef.current) suppressClickRef.current = false
			}}
			onClick={handleBackdropClick}
		>
			{resizable && (
				<div
					className={styles.resizeHandle}
					role="separator"
					tabIndex={0}
					aria-label="Изменить ширину панели"
					aria-orientation="vertical"
					aria-controls={panelId}
					aria-labelledby={titleId}
					aria-valuemin={minWidth}
					aria-valuemax={maxWidth}
					aria-valuenow={width}
					aria-valuetext={`${width} пикселей`}
					onPointerDown={startResize}
					onPointerMove={moveResize}
					onPointerUp={event => {
						if (resizeRef.current?.pointerId === event.pointerId)
							finishResize()
					}}
					onPointerCancel={event => {
						if (resizeRef.current?.pointerId === event.pointerId)
							finishResize(true)
					}}
					onLostPointerCapture={event => {
						if (resizeRef.current?.pointerId === event.pointerId)
							finishResize(true)
					}}
					onBlur={() => finishResize(true)}
					onKeyDown={resizeWithKeyboard}
					onDoubleClick={event => {
						event.preventDefault()
						event.stopPropagation()
						finishResize(true)
						setCustomWidth(null)
					}}
				/>
			)}
			<div id={panelId} className={styles.panel}>
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
					<div className={styles.headerActions}>
						<button
							type="button"
							className={styles.sizeButton}
							aria-pressed={fullscreen}
							onClick={() => setFullscreen(value => !value)}
						>
							{fullscreen ? 'Обычный размер' : 'На весь экран'}
						</button>
						<button
							ref={closeButtonRef}
							type="button"
							className={styles.closeButton}
							onClick={close}
							aria-label={closeLabel}
						>
							<AppIcon name="close" size={20} />
						</button>
					</div>
				</header>
				<DirtyFormScope id={scopeId}>
					<div className={styles.content}>{children}</div>
					{footer ? (
						<footer className={styles.footer}>{footer}</footer>
					) : null}
				</DirtyFormScope>
			</div>
		</dialog>
	)
}
