import {
	act,
	cleanup,
	fireEvent,
	render,
	screen
} from '@testing-library/react'
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import toast from 'react-hot-toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../toast-provider'
import { Drawer } from './Drawer'
import styles from './Drawer.module.scss'

beforeEach(() => {
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false }))
	)
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: {
			configurable: true,
			value: vi.fn(function (this: HTMLDialogElement) {
				this.open = true
			})
		},
		close: {
			configurable: true,
			value: vi.fn(function (this: HTMLDialogElement) {
				this.open = false
			})
		}
	})
	act(() => toast.remove())
})
afterEach(() => {
	cleanup()
	act(() => toast.remove())
	vi.unstubAllGlobals()
})

const notice = () => {
	act(() => {
		toast.success('Проверка уведомления', { duration: Infinity })
	})
	const statuses = screen.getAllByRole('status')
	expect(statuses).toHaveLength(1)
	return statuses[0]
}
const view = (outer = false, inner = false) => (
	<ToastProvider>
		<p>Основная страница</p>
		{outer ? (
			<Drawer isOpen onClose={vi.fn()} title="Первая панель">
				<p>Содержимое первой панели</p>
				{inner ? (
					<Drawer isOpen onClose={vi.fn()} title="Вторая панель">
						<p>Содержимое второй панели</p>
					</Drawer>
				) : null}
			</Drawer>
		) : null}
	</ToastProvider>
)

describe('Drawer singleton modal toast ownership', () => {
	it('uses one root toaster outside any dialog when no drawer is open', () => {
		render(view())
		expect(notice().closest('dialog')).toBeNull()
	})
	it('moves the singleton into the latest modal and restores its preceding host on close', () => {
		const mounted = render(view())
		notice()
		mounted.rerender(view(true))
		expect(screen.getAllByRole('status')).toHaveLength(1)
		expect(screen.getByRole('status').closest('dialog')).toBe(
			screen.getByRole('dialog', { name: 'Первая панель' })
		)
		mounted.rerender(view(true, true))
		expect(screen.getAllByRole('status')).toHaveLength(1)
		expect(screen.getByRole('status').closest('dialog')).toBe(
			screen.getByRole('dialog', { name: 'Вторая панель' })
		)
		mounted.rerender(view(true))
		expect(screen.getAllByRole('status')).toHaveLength(1)
		expect(screen.getByRole('status').closest('dialog')).toBe(
			screen.getByRole('dialog', { name: 'Первая панель' })
		)
		mounted.rerender(view())
		expect(screen.getAllByRole('status')).toHaveLength(1)
		expect(screen.getByRole('status').closest('dialog')).toBeNull()
		expect(
			document.documentElement.classList.contains('crm-drawer-scroll-lock')
		).toBe(false)
	})
	it('removes nested host registrations when their parent unmounts', () => {
		const mounted = render(view(true))
		mounted.rerender(view(true, true))
		notice()
		mounted.rerender(view())
		expect(screen.getAllByRole('status')).toHaveLength(1)
		expect(screen.getByRole('status').closest('dialog')).toBeNull()
		expect(screen.queryByRole('dialog')).toBeNull()
	})
	it('keeps exactly one live toast through StrictMode effect replay and closing via isOpen', () => {
		const tree = (isOpen: boolean) => (
			<StrictMode>
				<ToastProvider>
					<Drawer isOpen={isOpen} onClose={vi.fn()} title="Панель">
						Содержимое
					</Drawer>
				</ToastProvider>
			</StrictMode>
		)
		const mounted = render(tree(true))
		expect(notice().closest('dialog')).toBe(
			screen.getByRole('dialog', { name: 'Панель' })
		)
		mounted.rerender(tree(false))
		expect(screen.getAllByRole('status')).toHaveLength(1)
		expect(screen.getByRole('status').closest('dialog')).toBeNull()
		mounted.rerender(tree(true))
		expect(screen.getAllByRole('status')).toHaveLength(1)
		expect(screen.getByRole('status').closest('dialog')).toBe(
			screen.getByRole('dialog', { name: 'Панель' })
		)
	})
	it('keeps the active toast host if a protected close request leaves the drawer open', () => {
		const close = vi.fn()
		render(
			<ToastProvider>
				<Drawer isOpen onClose={close} title="Ожидающий запрос">
					Операция не подтверждена
				</Drawer>
			</ToastProvider>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		expect(close).toHaveBeenCalledOnce()
		expect(notice().closest('dialog')).toBe(
			screen.getByRole('dialog', { name: 'Ожидающий запрос' })
		)
	})
	it('has no modal registration or DOM mutation while server rendering', () => {
		const previousChildren = document.body.childElementCount
		const html = renderToString(view(true))
		expect(html).toContain('Первая панель')
		expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled()
		expect(document.body.childElementCount).toBe(previousChildren)
		expect(
			document.documentElement.classList.contains('crm-drawer-scroll-lock')
		).toBe(false)
	})
})

describe('Drawer accessible full title', () => {
	it('retains a long user title and description with dedicated wrapping styles and a named close action', () => {
		const title = 'А'.repeat(200)
		const description = 'Б'.repeat(200)
		const close = vi.fn()
		render(
			<Drawer
				isOpen
				title={title}
				description={description}
				onClose={close}
			>
				Данные карточки
			</Drawer>
		)
		const dialog = screen.getByRole('dialog', { name: title })
		const heading = screen.getByRole('heading', { name: title, level: 2 })
		expect(heading.classList.contains(styles.title)).toBe(true)
		expect(heading.textContent).toHaveLength(200)
		expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id)
		const text = screen.getByText(description)
		expect(text.classList.contains(styles.description)).toBe(true)
		expect(dialog.getAttribute('aria-describedby')).toBe(text.id)
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		expect(close).toHaveBeenCalledOnce()
	})
})
