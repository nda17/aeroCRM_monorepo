'use client'

import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import toast from 'react-hot-toast'
import styles from './AdminDatabases.module.scss'

const SECTIONS = [
	{ id: 'overview', label: 'Обзор' },
	{ id: 'history', label: 'История' },
	{ id: 'schedule', label: 'Расписание' },
	{ id: 'restore', label: 'Восстановление' }
] as const

type DatabaseSection = (typeof SECTIONS)[number]['id']

const DatabaseSections = ({
	panels
}: {
	panels: Record<DatabaseSection, ReactNode>
}) => {
	const id = useId()
	const [active, setActive] = useState<DatabaseSection>('overview')
	const select = (section: (typeof SECTIONS)[number]) => {
		if (section.id === active) return
		setActive(section.id)
		toast.success(`Открыт раздел «${section.label}»`, {
			id: 'database-section',
			duration: 1800
		})
	}
	const navigate = (
		event: KeyboardEvent<HTMLButtonElement>,
		index: number
	) => {
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? SECTIONS.length - 1
					: event.key === 'ArrowRight'
						? (index + 1) % SECTIONS.length
						: event.key === 'ArrowLeft'
							? (index + SECTIONS.length - 1) % SECTIONS.length
							: null
		if (next === null) return
		event.preventDefault()
		select(SECTIONS[next])
		document.getElementById(`${id}-${SECTIONS[next].id}-tab`)?.focus()
	}

	return (
		<div className={styles.sections}>
			<div
				className={styles.sectionTabs}
				role="tablist"
				aria-label="Резервные копии и восстановление"
			>
				{SECTIONS.map((section, index) => (
					<button
						key={section.id}
						type="button"
						role="tab"
						id={`${id}-${section.id}-tab`}
						aria-controls={`${id}-${section.id}-panel`}
						aria-selected={active === section.id}
						tabIndex={active === section.id ? 0 : -1}
						className={styles.sectionTab}
						onClick={() => select(section)}
						onKeyDown={event => navigate(event, index)}
					>
						{section.label}
					</button>
				))}
			</div>
			{SECTIONS.map(section => (
				<div
					key={section.id}
					id={`${id}-${section.id}-panel`}
					role="tabpanel"
					aria-labelledby={`${id}-${section.id}-tab`}
					tabIndex={0}
					hidden={active !== section.id}
					className={styles.sectionPanel}
				>
					{panels[section.id]}
				</div>
			))}
		</div>
	)
}

export default DatabaseSections
