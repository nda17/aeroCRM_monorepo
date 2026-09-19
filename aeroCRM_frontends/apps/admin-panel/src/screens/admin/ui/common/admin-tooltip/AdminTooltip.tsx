'use client'

import { useEffect, useId, useRef, useState } from 'react'
import styles from './AdminTooltip.module.scss'

export type AdminTooltipRisk = 'low' | 'medium' | 'high'

export interface AdminTooltipProps {
	title: string
	description: string
	risk?: AdminTooltipRisk
	riskText?: string
}

const riskLabel: Record<AdminTooltipRisk, string> = {
	low: 'Низкая опасность',
	medium: 'Средняя опасность',
	high: 'Высокая опасность'
}

const AdminTooltip = ({
	title,
	description,
	risk,
	riskText
}: AdminTooltipProps) => {
	const [isOpen, setIsOpen] = useState(false)
	const wrapperRef = useRef<HTMLSpanElement>(null)
	const tooltipId = useId()

	useEffect(() => {
		if (!isOpen) return

		const closeOnOutsideClick = (event: PointerEvent) => {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(event.target as Node)
			) {
				setIsOpen(false)
			}
		}

		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setIsOpen(false)
		}

		document.addEventListener('pointerdown', closeOnOutsideClick)
		document.addEventListener('keydown', closeOnEscape)

		return () => {
			document.removeEventListener('pointerdown', closeOnOutsideClick)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [isOpen])

	return (
		<span
			ref={wrapperRef}
			className={styles.help}
			onMouseEnter={() => setIsOpen(true)}
			onMouseLeave={() => setIsOpen(false)}
		>
			<button
				type="button"
				className={styles.helpBtn}
				aria-label={`Подсказка: ${title}`}
				aria-expanded={isOpen}
				aria-describedby={isOpen ? tooltipId : undefined}
				onClick={() => setIsOpen(prev => !prev)}
				onFocus={() => setIsOpen(true)}
			>
				?
			</button>
			{isOpen && (
				<span id={tooltipId} role="tooltip" className={styles.tooltip}>
					<span className={styles.tooltipTitle}>{title}</span>
					<span className={styles.tooltipText}>{description}</span>
					{risk && riskText && (
						<>
							<span
								className={`${styles.riskBadge} ${styles[`risk-${risk}`]}`}
							>
								{riskLabel[risk]}
							</span>
							<span className={styles.tooltipRisk}>{riskText}</span>
						</>
					)}
				</span>
			)}
		</span>
	)
}

export default AdminTooltip
