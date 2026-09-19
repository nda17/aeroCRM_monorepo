import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { ThemeSwitcher } from './ThemeSwitcher'

vi.mock('react-hot-toast', () => ({ default: vi.fn() }))
beforeEach(() => {
	localStorage.clear()
	document.documentElement.dataset.themePreference = 'light'
})
afterEach(() => {
	cleanup()
	localStorage.clear()
	delete document.documentElement.dataset.themePreference
	delete document.documentElement.dataset.theme
})
const open = () => {
	const trigger = screen.getByLabelText(/Тема оформления:/)
	trigger.click()
	return trigger
}

describe('ThemeSwitcher', () => {
	it('provides all preferences, saves selection and returns focus to trigger', () => {
		render(<ThemeSwitcher />)
		const trigger = open()
		expect(screen.getAllByRole('button')).toHaveLength(3)
		fireEvent.click(screen.getByRole('button', { name: 'Тёмная' }))
		expect(document.documentElement.dataset.theme).toBe('dark')
		expect(trigger.closest('details')?.open).toBe(false)
		expect(document.activeElement).toBe(trigger)
		expect(toast).toHaveBeenCalledWith('Тема: Тёмная', { id: 'crm-theme' })
		open()
		expect(
			screen
				.getByRole('button', { name: 'Тёмная' })
				.getAttribute('aria-pressed')
		).toBe('true')
	})
	it('does not notify for initial rendering or reselecting the same theme', () => {
		render(<ThemeSwitcher />)
		open()
		fireEvent.click(screen.getByRole('button', { name: 'Светлая' }))
		expect(toast).not.toHaveBeenCalled()
	})
	it('closes with Escape, outside pointer and focus leaving the control', () => {
		render(
			<>
				<ThemeSwitcher />
				<button>Вне переключателя</button>
			</>
		)
		const trigger = open()
		fireEvent.keyDown(screen.getByRole('button', { name: 'Тёмная' }), {
			key: 'Escape'
		})
		expect(trigger.closest('details')?.open).toBe(false)
		expect(document.activeElement).toBe(trigger)
		open()
		fireEvent.pointerDown(document.body)
		expect(trigger.closest('details')?.open).toBe(false)
		open()
		fireEvent.blur(trigger, {
			relatedTarget: screen.getByRole('button', {
				name: 'Вне переключателя'
			})
		})
		expect(trigger.closest('details')?.open).toBe(false)
	})
})
