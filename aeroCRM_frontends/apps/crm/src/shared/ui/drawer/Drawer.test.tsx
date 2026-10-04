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
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirtyFormProvider, useDirtyForm } from '@/shared/lib/dirty-form'
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
const resizeHandle = (dialog: HTMLElement) =>
	dialog.querySelector<HTMLElement>(':scope > [role="separator"]')!
const expectAttribute = (element: Element, name: string, value: string) =>
	expect(element.getAttribute(name)).toBe(value)
const pointer = (
	target: Element | Window,
	type: string,
	values: Record<string, number | boolean>
) => {
	const event = new Event(type, { bubbles: true, cancelable: true })
	for (const [key, value] of Object.entries(values))
		Object.defineProperty(event, key, { configurable: true, value })
	fireEvent(target, event)
}
const capturePointer = (handle: HTMLElement) => {
	const setPointerCapture = vi.fn()
	const hasPointerCapture = vi.fn(() => true)
	const releasePointerCapture = vi.fn()
	Object.defineProperties(handle, {
		setPointerCapture: { configurable: true, value: setPointerCapture },
		hasPointerCapture: { configurable: true, value: hasPointerCapture },
		releasePointerCapture: {
			configurable: true,
			value: releasePointerCapture
		}
	})
	return { setPointerCapture, releasePointerCapture }
}
const setViewport = (width: number) => {
	act(() => {
		Object.defineProperty(window, 'innerWidth', {
			configurable: true,
			value: width
		})
		fireEvent(window, new Event('resize'))
	})
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

describe('Drawer cancel events', () => {
	it('does not close the drawer when a nested file input cancels selection', () => {
		const close = vi.fn()
		render(
			<Drawer isOpen onClose={close} title="Импорт каталога">
				<input type="file" aria-label="Файл каталога" />
			</Drawer>
		)

		fireEvent(
			screen.getByLabelText('Файл каталога'),
			new Event('cancel', { bubbles: true, cancelable: true })
		)

		expect(close).not.toHaveBeenCalled()
		const dialog = screen.getByRole('dialog', {
			name: 'Импорт каталога'
		}) as HTMLDialogElement
		expect(dialog.open).toBe(true)
	})

	it('prevents the native dialog cancel and requests the drawer close', () => {
		const close = vi.fn()
		render(
			<Drawer isOpen onClose={close} title="Панель отмены">
				Содержимое
			</Drawer>
		)
		const dialog = screen.getByRole('dialog', { name: 'Панель отмены' })
		const event = new Event('cancel', { bubbles: true, cancelable: true })

		fireEvent(dialog, event)

		expect(event.defaultPrevented).toBe(true)
		expect(close).toHaveBeenCalledOnce()
	})
})

describe('Drawer fullscreen draft preservation', () => {
	it('resizes the same draft DOM and still guards a close with dirty-form confirmation', () => {
		const close = vi.fn()
		const DraftContent = () => {
			const [draft, setDraft] = useState('Черновик')
			useDirtyForm({ dirty: !!draft, label: 'Карточка сделки' })
			return (
				<label>
					Черновик
					<input
						value={draft}
						onChange={event => setDraft(event.target.value)}
					/>
				</label>
			)
		}
		render(
			<DirtyFormProvider owner="owner">
				<ToastProvider>
					<Drawer isOpen onClose={close} title="Карточка сделки">
						<DraftContent />
					</Drawer>
				</ToastProvider>
			</DirtyFormProvider>
		)
		const draft = screen.getByRole('textbox', { name: 'Черновик' })
		const drawer = screen.getByRole('dialog', { name: 'Карточка сделки' })
		fireEvent.click(screen.getByRole('button', { name: 'На весь экран' }))
		expect(screen.getByRole('dialog', { name: 'Карточка сделки' })).toBe(
			drawer
		)
		expect(screen.getByRole('textbox', { name: 'Черновик' })).toBe(draft)
		expect(draft).toHaveProperty('value', 'Черновик')
		expect(drawer.classList.contains(styles.fullscreen)).toBe(true)
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		const confirmDialog = Array.from(
			document.querySelectorAll('dialog')
		).find(dialog =>
			dialog.textContent?.includes('Несохранённые изменения')
		)
		const continueButton = Array.from(
			confirmDialog?.querySelectorAll('button') ?? []
		).find(button =>
			button.textContent?.includes('Продолжить редактирование')
		)
		expect(continueButton).toBeTruthy()
		fireEvent.click(continueButton!)
		expect(close).not.toHaveBeenCalled()
		expect(
			screen.getByRole('textbox', { name: 'Черновик' })
		).toHaveProperty('value', 'Черновик')
	})
})

describe('Drawer resizing', () => {
	it('resizes a right panel with pointer capture and finishes after the pointer leaves the handle', () => {
		const close = vi.fn()
		render(
			<Drawer isOpen onClose={close} title="Правая панель">
				Содержимое
			</Drawer>
		)
		const dialog = screen.getByRole('dialog', { name: 'Правая панель' })
		const handle = resizeHandle(dialog)
		const capture = capturePointer(handle)

		expectAttribute(handle, 'aria-orientation', 'vertical')
		expectAttribute(handle, 'aria-valuemin', '480')
		expectAttribute(handle, 'aria-valuenow', '512')
		expectAttribute(
			handle,
			'aria-controls',
			dialog.querySelector('.' + styles.panel)!.id
		)
		pointer(handle, 'pointerdown', {
			button: 0,
			isPrimary: true,
			pointerId: 7,
			clientX: 300
		})
		pointer(handle, 'pointermove', { pointerId: 7, clientX: 220 })
		expectAttribute(handle, 'aria-valuenow', '592')
		pointer(handle, 'pointerup', { pointerId: 7, clientX: 220 })

		expect(capture.setPointerCapture).toHaveBeenCalledWith(7)
		expect(capture.releasePointerCapture).toHaveBeenCalledWith(7)
		expectAttribute(handle, 'aria-valuetext', '592 пикселей')
		expect(dialog.style.getPropertyValue('--drawer-width')).toBe('592px')
		expect(close).not.toHaveBeenCalled()
	})

	it('sizes a left panel in the opposite direction and ignores secondary or non-primary pointers', () => {
		render(
			<Drawer
				isOpen
				side="left"
				size="sm"
				onClose={vi.fn()}
				title="Левая панель"
			>
				Содержимое
			</Drawer>
		)
		const dialog = screen.getByRole('dialog', { name: 'Левая панель' })
		const handle = resizeHandle(dialog)
		const capture = capturePointer(handle)
		pointer(handle, 'pointerdown', {
			button: 2,
			isPrimary: true,
			pointerId: 1,
			clientX: 300
		})
		pointer(handle, 'pointerdown', {
			button: 0,
			isPrimary: false,
			pointerId: 2,
			clientX: 300
		})
		expect(capture.setPointerCapture).not.toHaveBeenCalled()
		expectAttribute(handle, 'aria-valuenow', '384')

		pointer(handle, 'pointerdown', {
			button: 0,
			isPrimary: true,
			pointerId: 3,
			clientX: 300
		})
		pointer(handle, 'pointermove', { pointerId: 3, clientX: 380 })
		pointer(handle, 'pointerup', { pointerId: 3, clientX: 380 })
		expectAttribute(handle, 'aria-valuenow', '464')
		fireEvent.keyDown(handle, { key: 'ArrowRight' })
		expectAttribute(handle, 'aria-valuenow', '480')
		fireEvent.keyDown(handle, { key: 'Home' })
		expectAttribute(handle, 'aria-valuenow', '384')
		fireEvent.keyDown(handle, { key: 'End' })
		expectAttribute(handle, 'aria-valuenow', '1000')
		fireEvent.doubleClick(handle)
		expectAttribute(handle, 'aria-valuenow', '384')
	})

	it('clamps to each preset minimum and the viewport maximum and supports keyboard resizing and reset', () => {
		setViewport(700)
		render(
			<Drawer isOpen onClose={vi.fn()} title="Ограниченная панель">
				Содержимое
			</Drawer>
		)
		const dialog = screen.getByRole('dialog', {
			name: 'Ограниченная панель'
		})
		const handle = resizeHandle(dialog)
		const capture = capturePointer(handle)

		expectAttribute(handle, 'aria-valuemax', '676')
		pointer(handle, 'pointerdown', {
			button: 0,
			isPrimary: true,
			pointerId: 4,
			clientX: 300
		})
		pointer(handle, 'pointermove', { pointerId: 4, clientX: -500 })
		pointer(handle, 'pointerup', { pointerId: 4, clientX: -500 })
		expectAttribute(handle, 'aria-valuenow', '676')
		fireEvent.keyDown(handle, { key: 'Home' })
		expectAttribute(handle, 'aria-valuenow', '480')
		fireEvent.keyDown(handle, { key: 'ArrowLeft' })
		expectAttribute(handle, 'aria-valuenow', '496')
		fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
		expectAttribute(handle, 'aria-valuenow', '480')
		fireEvent.keyDown(handle, { key: 'End' })
		expectAttribute(handle, 'aria-valuenow', '676')
		fireEvent.doubleClick(handle)
		expectAttribute(handle, 'aria-valuenow', '512')
		expect(capture.setPointerCapture).toHaveBeenCalledOnce()
	})

	it.each(['pointercancel', 'lostpointercapture', 'blur'] as const)(
		'cancels a resize on %s and restores the starting width',
		eventName => {
			render(
				<Drawer isOpen onClose={vi.fn()} title="Отмена изменения">
					Содержимое
				</Drawer>
			)
			const dialog = screen.getByRole('dialog', {
				name: 'Отмена изменения'
			})
			const handle = resizeHandle(dialog)
			capturePointer(handle)
			pointer(handle, 'pointerdown', {
				button: 0,
				isPrimary: true,
				pointerId: 5,
				clientX: 300
			})
			pointer(handle, 'pointermove', { pointerId: 5, clientX: 240 })
			expectAttribute(handle, 'aria-valuenow', '572')
			if (eventName === 'blur') fireEvent(window, new Event('blur'))
			else pointer(handle, eventName, { pointerId: 5, clientX: 240 })
			expectAttribute(resizeHandle(dialog), 'aria-valuenow', '512')
		}
	)

	it('cancels a drag on Escape without closing, then applies the dirty guard to a normal Escape', () => {
		const close = vi.fn()
		const DraftContent = () => {
			const [draft, setDraft] = useState('План')
			useDirtyForm({ dirty: !!draft, label: 'План встречи' })
			return (
				<label>
					Черновик
					<input
						value={draft}
						onChange={event => setDraft(event.target.value)}
					/>
				</label>
			)
		}
		render(
			<DirtyFormProvider owner="owner">
				<Drawer isOpen onClose={close} title="План встречи">
					<DraftContent />
				</Drawer>
			</DirtyFormProvider>
		)
		const dialog = screen.getByRole('dialog', { name: 'План встречи' })
		const handle = resizeHandle(dialog)
		capturePointer(handle)
		const draft = screen.getByRole('textbox', { name: 'Черновик' })
		pointer(handle, 'pointerdown', {
			button: 0,
			isPrimary: true,
			pointerId: 6,
			clientX: 300
		})
		pointer(handle, 'pointermove', { pointerId: 6, clientX: 220 })
		fireEvent.keyDown(handle, { key: 'Escape' })
		expectAttribute(resizeHandle(dialog), 'aria-valuenow', '512')
		expect(close).not.toHaveBeenCalled()
		expect(
			screen.queryByRole('dialog', { name: 'Несохранённые изменения' })
		).toBeNull()

		const cancel = new Event('cancel', { bubbles: true, cancelable: true })
		fireEvent(dialog, cancel)
		expect(cancel.defaultPrevented).toBe(true)
		expect(close).not.toHaveBeenCalled()
		expect(
			screen.getByRole('dialog', { name: 'Несохранённые изменения' })
		).toBeTruthy()
		expect(screen.getByRole('textbox', { name: 'Черновик' })).toBe(draft)
		expect(
			screen.getByRole('textbox', { name: 'Черновик' })
		).toHaveProperty('value', 'План')
	})

	it('preserves the draft DOM and custom width through fullscreen and responsive transitions', () => {
		const DraftContent = () => {
			const [draft, setDraft] = useState('Черновик сделки')
			return (
				<label>
					Данные
					<input
						value={draft}
						onChange={event => setDraft(event.target.value)}
					/>
				</label>
			)
		}
		render(
			<Drawer isOpen onClose={vi.fn()} title="Редактор сделки">
				<DraftContent />
			</Drawer>
		)
		const dialog = screen.getByRole('dialog', { name: 'Редактор сделки' })
		const draft = screen.getByRole('textbox', { name: 'Данные' })
		const handle = resizeHandle(dialog)
		capturePointer(handle)
		pointer(handle, 'pointerdown', {
			button: 0,
			isPrimary: true,
			pointerId: 8,
			clientX: 300
		})
		pointer(handle, 'pointermove', { pointerId: 8, clientX: 200 })
		pointer(handle, 'pointerup', { pointerId: 8, clientX: 200 })
		expectAttribute(handle, 'aria-valuenow', '612')
		fireEvent.click(screen.getByRole('button', { name: 'На весь экран' }))
		expect(screen.queryByRole('separator')).toBeNull()
		expect(screen.getByRole('textbox', { name: 'Данные' })).toBe(draft)
		fireEvent.click(screen.getByRole('button', { name: 'Обычный размер' }))
		expectAttribute(resizeHandle(dialog), 'aria-valuenow', '612')
		setViewport(639)
		expect(screen.queryByRole('separator')).toBeNull()
		setViewport(640)
		expectAttribute(resizeHandle(dialog), 'aria-valuenow', '612')
		expect(screen.getByRole('textbox', { name: 'Данные' })).toBe(draft)
	})

	it('keeps nested panel widths independent and releases the shared scroll lock only after the last panel closes', () => {
		const mounted = render(view(true, true))
		const outer = screen.getByRole('dialog', { name: 'Первая панель' })
		const inner = screen.getByRole('dialog', { name: 'Вторая панель' })
		const outerHandle = resizeHandle(outer)
		const innerHandle = resizeHandle(inner)
		capturePointer(innerHandle)
		pointer(innerHandle, 'pointerdown', {
			button: 0,
			isPrimary: true,
			pointerId: 9,
			clientX: 300
		})
		pointer(innerHandle, 'pointermove', { pointerId: 9, clientX: 220 })
		pointer(innerHandle, 'pointerup', { pointerId: 9, clientX: 220 })
		expectAttribute(innerHandle, 'aria-valuenow', '592')
		expectAttribute(outerHandle, 'aria-valuenow', '512')
		expect(
			document.documentElement.classList.contains('crm-drawer-scroll-lock')
		).toBe(true)
		mounted.rerender(view(true))
		expect(
			document.documentElement.classList.contains('crm-drawer-scroll-lock')
		).toBe(true)
		mounted.rerender(view())
		expect(
			document.documentElement.classList.contains('crm-drawer-scroll-lock')
		).toBe(false)
	})

	it('releases pointer capture and scroll lock when unmounted mid-drag', () => {
		const mounted = render(
			<Drawer isOpen onClose={vi.fn()} title="Снятие панели">
				Содержимое
			</Drawer>
		)
		const dialog = screen.getByRole('dialog', { name: 'Снятие панели' })
		const handle = resizeHandle(dialog)
		const capture = capturePointer(handle)
		pointer(handle, 'pointerdown', {
			button: 0,
			isPrimary: true,
			pointerId: 10,
			clientX: 300
		})
		pointer(handle, 'pointermove', { pointerId: 10, clientX: 220 })
		mounted.unmount()
		expect(capture.releasePointerCapture).toHaveBeenCalledWith(10)
		expect(
			document.documentElement.classList.contains('crm-drawer-scroll-lock')
		).toBe(false)
	})
})
