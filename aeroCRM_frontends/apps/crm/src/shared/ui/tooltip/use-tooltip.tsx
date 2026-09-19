'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tooltip.module.scss'

// Coordinate descriptions across navigation and actions without a global store.
const OPEN_DESCRIPTION_EVENT = 'wincrm:navigation-description-open'

interface TooltipAnchor {
	element: HTMLElement
	host: HTMLElement
}

const TooltipPortal = ({
	id,
	anchor,
	description,
	onEnter,
	onLeave
}: {
	id: string
	anchor: TooltipAnchor
	description: string
	onEnter: () => void
	onLeave: () => void
}) => {
	const ref = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		const tooltip = ref.current
		if (!tooltip) return
		const target = anchor.element.getBoundingClientRect()
		const dialog = anchor.host instanceof HTMLDialogElement
		const bounds = dialog
			? anchor.host.getBoundingClientRect()
			: {
					left: 0,
					top: 0,
					right: window.innerWidth,
					bottom: window.innerHeight
				}
		const gap = 8
		const left = Math.max(gap, bounds.left + gap)
		const right = Math.min(window.innerWidth - gap, bounds.right - gap)
		const top = Math.max(gap, bounds.top + gap)
		const bottom = Math.min(window.innerHeight - gap, bounds.bottom - gap)
		tooltip.style.maxWidth = `${Math.max(0, right - left)}px`
		tooltip.style.maxHeight = `${Math.max(0, bottom - top)}px`
		const box = tooltip.getBoundingClientRect()
		const beside = target.right + gap + box.width <= right
		const x = beside ? target.right + gap : target.left
		const y = beside
			? target.top + (target.height - box.height) / 2
			: target.bottom + gap + box.height <= bottom
				? target.bottom + gap
				: target.top - gap - box.height
		tooltip.style.left = `${Math.max(left, Math.min(x, right - box.width))}px`
		tooltip.style.top = `${Math.max(top, Math.min(y, bottom - box.height))}px`
		tooltip.style.visibility = 'visible'
	}, [anchor, description])

	return createPortal(
		<div
			ref={ref}
			id={id}
			role="tooltip"
			className={styles.tooltip}
			onPointerEnter={onEnter}
			onPointerLeave={onLeave}
		>
			{description}
		</div>,
		anchor.host
	)
}

export const useTooltip = <T extends HTMLElement>(
	description?: string,
	enabled = true
) => {
	const active = enabled && !!description
	const id = useId()
	const [anchor, setAnchor] = useState<TooltipAnchor | null>(null)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pointerFocus = useRef(false)
	const keyboardFocus = useRef(false)
	const hovered = useRef(false)
	const tooltipHovered = useRef(false)
	const clearTimer = () => {
		if (timer.current !== null) clearTimeout(timer.current)
		timer.current = null
	}
	const close = () => {
		clearTimer()
		tooltipHovered.current = false
		setAnchor(null)
	}
	const open = (element: T) => {
		clearTimer()
		if (!active || !element.isConnected) return
		window.dispatchEvent(
			new CustomEvent(OPEN_DESCRIPTION_EVENT, { detail: id })
		)
		tooltipHovered.current = false
		setAnchor({
			element,
			// Keep mobile descriptions inside the native dialog's top layer.
			host:
				element.closest<HTMLDialogElement>('dialog[open]') ?? document.body
		})
	}
	const leave = () => {
		clearTimer()
		// A small bridge lets the pointer reach the bubble across its visual gap.
		if (!keyboardFocus.current)
			timer.current = setTimeout(() => {
				if (!hovered.current && !tooltipHovered.current) setAnchor(null)
			}, 120)
	}
	useEffect(
		() => () => {
			if (timer.current !== null) clearTimeout(timer.current)
		},
		[]
	)
	useEffect(() => {
		if (!active) return
		const dismiss = () => {
			if (timer.current !== null) clearTimeout(timer.current)
			timer.current = null
			tooltipHovered.current = false
			setAnchor(null)
		}
		const otherDescriptionOpened = (event: Event) => {
			if (event instanceof CustomEvent && event.detail !== id) dismiss()
		}
		const keydown = (event: globalThis.KeyboardEvent) => {
			if (event.key !== 'Escape') return
			// The first Escape dismisses only this description, not its parent drawer.
			if (anchor) {
				event.preventDefault()
				event.stopPropagation()
			}
			dismiss()
		}
		window.addEventListener('scroll', dismiss, true)
		window.addEventListener('resize', dismiss)
		window.addEventListener('keydown', keydown, true)
		window.addEventListener('pointerdown', dismiss, true)
		window.addEventListener(OPEN_DESCRIPTION_EVENT, otherDescriptionOpened)
		return () => {
			window.removeEventListener('scroll', dismiss, true)
			window.removeEventListener('resize', dismiss)
			window.removeEventListener('keydown', keydown, true)
			window.removeEventListener('pointerdown', dismiss, true)
			window.removeEventListener(
				OPEN_DESCRIPTION_EVENT,
				otherDescriptionOpened
			)
		}
	}, [anchor, active, id])

	const triggerProps: HTMLAttributes<T> = {
		'aria-describedby': active && anchor ? id : undefined,
		onPointerEnter: event => {
			if (!active || event.pointerType !== 'mouse') return
			hovered.current = true
			clearTimer()
			const element = event.currentTarget
			timer.current = setTimeout(() => open(element), 250)
		},
		onPointerLeave: () => {
			hovered.current = false
			leave()
		},
		onPointerDown: () => {
			pointerFocus.current = true
			keyboardFocus.current = false
			close()
		},
		onKeyDown: () => {
			pointerFocus.current = false
		},
		onFocus: event => {
			if (pointerFocus.current) return
			keyboardFocus.current = true
			open(event.currentTarget)
		},
		onBlur: () => {
			pointerFocus.current = false
			keyboardFocus.current = false
			close()
		},
		onClick: close
	}
	return {
		triggerProps,
		close,
		tooltip:
			active && anchor ? (
				<TooltipPortal
					id={id}
					anchor={anchor}
					description={description!}
					onEnter={() => {
						tooltipHovered.current = true
						clearTimer()
					}}
					onLeave={() => {
						tooltipHovered.current = false
						leave()
					}}
				/>
			) : null
	}
}
