'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import toast from 'react-hot-toast'
import {
	getServerThemePreference,
	getThemePreference,
	setThemePreference,
	subscribeTheme,
	themePreferences,
	type ThemePreference
} from '@/shared/lib/theme/theme'
import { AppIcon, type AppIconName } from '../app-icon'
import styles from './ThemeSwitcher.module.scss'

const labels: Record<ThemePreference, string> = {
	light: 'Светлая',
	dark: 'Тёмная',
	system: 'Как на устройстве'
}
const icons: Record<ThemePreference, AppIconName> = {
	light: 'settings',
	dark: 'moon',
	system: 'monitor'
}

export const ThemeSwitcher = () => {
	const preference = useSyncExternalStore(
		subscribeTheme,
		getThemePreference,
		getServerThemePreference
	)
	const details = useRef<HTMLDetailsElement>(null)
	useEffect(() => {
		const closeOutside = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!details.current?.contains(event.target)
			) {
				if (details.current) details.current.open = false
			}
		}
		document.addEventListener('pointerdown', closeOutside)
		return () => document.removeEventListener('pointerdown', closeOutside)
	}, [])

	return (
		<details
			ref={details}
			className={styles.switcher}
			onBlur={event => {
				if (!event.currentTarget.contains(event.relatedTarget))
					event.currentTarget.open = false
			}}
			onKeyDown={event => {
				if (event.key !== 'Escape' || !details.current?.open) return
				event.preventDefault()
				event.stopPropagation()
				details.current.open = false
				details.current.querySelector('summary')?.focus()
			}}
		>
			<summary
				className={styles.trigger}
				aria-label={`Тема оформления: ${labels[preference]}`}
				title="Тема оформления"
			>
				<AppIcon name={icons[preference]} size={20} />
			</summary>
			<div
				className={styles.panel}
				role="group"
				aria-label="Тема оформления"
			>
				<p className={styles.heading}>Оформление aeroCRM</p>
				{themePreferences.map(value => (
					<button
						key={value}
						type="button"
						className={styles.option}
						aria-pressed={preference === value}
						onClick={() => {
							if (value !== preference) {
								const saved = setThemePreference(value)
								toast(
									saved
										? `Тема: ${labels[value]}`
										: 'Тема изменена. Браузер не разрешил сохранить выбор.',
									{ id: 'crm-theme' }
								)
							}
							if (details.current) {
								details.current.open = false
								details.current.querySelector('summary')?.focus()
							}
						}}
					>
						<AppIcon name={icons[value]} size={18} />
						<span>{labels[value]}</span>
						{preference === value && <AppIcon name="check" size={16} />}
					</button>
				))}
			</div>
		</details>
	)
}
