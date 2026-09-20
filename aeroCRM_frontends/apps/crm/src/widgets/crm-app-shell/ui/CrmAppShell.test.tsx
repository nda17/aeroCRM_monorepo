import {
	act,
	cleanup,
	createEvent,
	fireEvent,
	render,
	screen,
	within
} from '@testing-library/react'
import type { ComponentProps } from 'react'
import toast from 'react-hot-toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CrmAppShell from './CrmAppShell'
import { CRM_NAVIGATION } from '../model/crm-navigation'

const fixture = vi.hoisted(() => ({
	pathname: '/inbox',
	companyName: null as string | null,
	access: {
		state: 'ACTIVE' as 'ACTIVE' | 'GRACE' | 'READ_ONLY',
		isReadOnly: false,
		membership: { role: 'OWNER' as 'OWNER' | 'MEMBER' },
		entitlement: {
			graceUntil: '2026-09-12T12:00:00.000Z' as string | null
		}
	}
}))
vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname }))
vi.mock('@/features/manage-reminders', () => ({
	TaskNotificationCenter: () => <button>Уведомления</button>
}))
vi.mock('@/entities/crm-access', () => ({
	useCrmWorkspaceAccess: () => fixture.access
}))
vi.mock('@/entities/crm-workspace-branding', () => ({
	useWorkspaceBranding: () => ({
		data: { branding: { displayName: fixture.companyName } }
	})
}))
vi.mock('react-hot-toast', () => ({ default: vi.fn() }))
vi.mock('next/link', () => ({
	default: ({ children, onClick, ...props }: ComponentProps<'a'>) => (
		<a
			{...props}
			onClick={event => {
				onClick?.(event)
				event.preventDefault()
			}}
		>
			{children}
		</a>
	)
}))

beforeEach(() => {
	fixture.pathname = '/inbox'
	fixture.companyName = null
	fixture.access.state = 'ACTIVE'
	fixture.access.isReadOnly = false
	fixture.access.membership.role = 'OWNER'
	fixture.access.entitlement.graceUntil = '2026-09-12T12:00:00.000Z'
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = true
			}
		},
		close: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = false
			}
		}
	})
})
afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.restoreAllMocks()
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})
const mount = () =>
	render(
		<CrmAppShell>
			<h1>Содержимое раздела</h1>
		</CrmAppShell>
	)
const mainNavigation = () =>
	screen.getByRole('navigation', { name: 'Основная навигация CRM' })

const pointer = (
	element: Element,
	type: 'over' | 'out' | 'down',
	pointerType = 'mouse'
) => {
	const event =
		type === 'over'
			? createEvent.pointerOver(element)
			: type === 'out'
				? createEvent.pointerOut(element)
				: createEvent.pointerDown(element)
	Object.defineProperty(event, 'pointerType', { value: pointerType })
	fireEvent(element, event)
}

describe('CRM navigation descriptions', () => {
	it('describes all seven sections on keyboard focus without changing names, links or current state', () => {
		mount()
		for (const item of CRM_NAVIGATION) {
			const link = within(mainNavigation()).getByRole('link', {
				name: item.label
			})
			fireEvent.focus(link)
			const tooltip = screen.getByRole('tooltip')
			expect(tooltip.textContent).toBe(item.description)
			expect(link.getAttribute('aria-describedby')).toBe(tooltip.id)
			expect(link.getAttribute('href')).toBe(item.href)
			expect(link.hasAttribute('title')).toBe(false)
			expect(tooltip.parentElement).toBe(document.body)
			expect(mainNavigation().contains(tooltip)).toBe(false)
			fireEvent.blur(link)
			expect(screen.queryByRole('tooltip')).toBeNull()
			expect(link.hasAttribute('aria-describedby')).toBe(false)
		}
		expect(toast).not.toHaveBeenCalled()
	})
	it('delays mouse hover, remains hoverable across the gap, and closes after leaving the bubble', () => {
		vi.useFakeTimers()
		mount()
		const link = within(mainNavigation()).getByRole('link', {
			name: 'Контакты'
		})
		pointer(link, 'over')
		act(() => vi.advanceTimersByTime(249))
		expect(screen.queryByRole('tooltip')).toBeNull()
		act(() => vi.advanceTimersByTime(1))
		const tooltip = screen.getByRole('tooltip')
		pointer(link, 'out')
		act(() => vi.advanceTimersByTime(60))
		pointer(tooltip, 'over')
		act(() => vi.advanceTimersByTime(200))
		expect(screen.getByRole('tooltip')).toBe(tooltip)
		pointer(tooltip, 'out')
		act(() => vi.advanceTimersByTime(121))
		expect(screen.queryByRole('tooltip')).toBeNull()
	})
	it('dismisses both open and delayed descriptions on scroll and resize', () => {
		vi.useFakeTimers()
		mount()
		const link = within(mainNavigation()).getByRole('link', {
			name: 'Сделки'
		})
		pointer(link, 'over')
		fireEvent.scroll(mainNavigation().parentElement!)
		act(() => vi.advanceTimersByTime(300))
		expect(screen.queryByRole('tooltip')).toBeNull()
		fireEvent.focus(link)
		expect(screen.getByRole('tooltip')).toBeTruthy()
		fireEvent.scroll(window)
		expect(screen.queryByRole('tooltip')).toBeNull()
		fireEvent.focus(link)
		fireEvent.resize(window)
		expect(screen.queryByRole('tooltip')).toBeNull()
	})
	it('shows at most one description when mouse hover moves away from a keyboard-focused link', () => {
		vi.useFakeTimers()
		mount()
		const links = within(mainNavigation())
		const first = links.getByRole('link', { name: 'Контакты' })
		const second = links.getByRole('link', { name: 'Сделки' })
		fireEvent.focus(first)
		pointer(second, 'over')
		act(() => vi.advanceTimersByTime(250))
		expect(screen.getAllByRole('tooltip')).toHaveLength(1)
		expect(first.hasAttribute('aria-describedby')).toBe(false)
		expect(screen.getByRole('tooltip').textContent).toBe(
			CRM_NAVIGATION[2].description
		)
	})
	it('cancels a pending hover on Escape without consuming the enclosing drawer escape', () => {
		vi.useFakeTimers()
		mount()
		const link = within(mainNavigation()).getByRole('link', {
			name: 'Контакты'
		})
		pointer(link, 'over')
		const escape = createEvent.keyDown(link, { key: 'Escape' })
		fireEvent(link, escape)
		act(() => vi.advanceTimersByTime(300))
		expect(escape.defaultPrevented).toBe(false)
		expect(screen.queryByRole('tooltip')).toBeNull()
	})
	it('does not retain a stale bubble-hover flag after scroll dismisses the portal', () => {
		vi.useFakeTimers()
		mount()
		const link = within(mainNavigation()).getByRole('link', {
			name: 'Контакты'
		})
		pointer(link, 'over')
		act(() => vi.advanceTimersByTime(250))
		pointer(link, 'out')
		pointer(screen.getByRole('tooltip'), 'over')
		fireEvent.scroll(window)
		pointer(link, 'over')
		act(() => vi.advanceTimersByTime(250))
		expect(screen.getByRole('tooltip')).toBeTruthy()
		pointer(link, 'out')
		act(() => vi.advanceTimersByTime(121))
		expect(screen.queryByRole('tooltip')).toBeNull()
	})
	it('cancels delayed hover and removes portal content on collapse, route changes and unmount', () => {
		vi.useFakeTimers()
		const view = mount()
		pointer(
			within(mainNavigation()).getByRole('link', { name: 'Задачи' }),
			'over'
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Свернуть боковую панель' })
		)
		act(() => vi.advanceTimersByTime(300))
		expect(screen.queryByRole('tooltip')).toBeNull()
		fireEvent.click(
			screen.getByRole('button', { name: 'Развернуть боковую панель' })
		)
		fireEvent.focus(
			within(mainNavigation()).getByRole('link', { name: 'Настройки' })
		)
		expect(screen.getByRole('tooltip')).toBeTruthy()
		fixture.pathname = '/tasks'
		view.rerender(
			<CrmAppShell>
				<h1>Контент</h1>
			</CrmAppShell>
		)
		expect(screen.queryByRole('tooltip')).toBeNull()
		pointer(
			within(mainNavigation()).getByRole('link', { name: 'Задачи' }),
			'over'
		)
		view.unmount()
		act(() => vi.advanceTimersByTime(300))
		expect(screen.queryByRole('tooltip')).toBeNull()
	})
	it('does not open a tooltip for touch-generated hover/focus or require a second mobile tap', () => {
		vi.useFakeTimers()
		mount()
		fireEvent.click(
			screen.getByRole('button', { name: 'Открыть навигацию CRM' })
		)
		const link = within(
			screen.getByRole('navigation', { name: 'Мобильная навигация CRM' })
		).getByRole('link', { name: 'Планировщик' })
		pointer(link, 'over', 'touch')
		pointer(link, 'down', 'touch')
		fireEvent.focus(link)
		act(() => vi.advanceTimersByTime(300))
		expect(screen.queryByRole('tooltip')).toBeNull()
		fireEvent.click(link)
		expect(link.getAttribute('href')).toBe('/planner')
		expect(screen.queryByRole('dialog')).toBeNull()
	})
	it('keeps mobile keyboard descriptions inside the dialog top layer and consumes only the first Escape', () => {
		mount()
		fireEvent.click(
			screen.getByRole('button', { name: 'Открыть навигацию CRM' })
		)
		const dialog = screen.getByRole('dialog')
		const link = within(dialog).getByRole('link', { name: 'Планировщик' })
		fireEvent.focus(link)
		expect(screen.getByRole('tooltip').parentElement).toBe(dialog)
		const firstEscape = createEvent.keyDown(link, { key: 'Escape' })
		fireEvent(link, firstEscape)
		expect(firstEscape.defaultPrevented).toBe(true)
		expect(screen.queryByRole('tooltip')).toBeNull()
		expect(screen.getByRole('dialog')).toBe(dialog)
		const secondEscape = createEvent.keyDown(link, { key: 'Escape' })
		fireEvent(link, secondEscape)
		expect(secondEscape.defaultPrevented).toBe(false)
		fireEvent(
			dialog,
			new Event('cancel', { bubbles: false, cancelable: true })
		)
		expect(screen.queryByRole('dialog')).toBeNull()
	})
	it('bounds mobile positioning to the dialog and viewport instead of clipping in sidebar content', () => {
		mount()
		fireEvent.click(
			screen.getByRole('button', { name: 'Открыть навигацию CRM' })
		)
		const dialog = screen.getByRole('dialog')
		const link = within(dialog).getByRole('link', { name: 'Настройки' })
		vi.spyOn(
			HTMLElement.prototype,
			'getBoundingClientRect'
		).mockImplementation(function (this: HTMLElement) {
			const rect =
				this === dialog
					? { x: 0, y: 0, width: 380, height: 500 }
					: this === link
						? { x: 24, y: 420, width: 330, height: 44 }
						: { x: 0, y: 0, width: 288, height: 60 }
			return {
				...rect,
				left: rect.x,
				top: rect.y,
				right: rect.x + rect.width,
				bottom: rect.y + rect.height,
				toJSON: () => ({})
			}
		})
		fireEvent.focus(link)
		const tooltip = screen.getByRole('tooltip')
		expect(tooltip.style.left).toBe('24px')
		expect(tooltip.style.top).toBe('352px')
		expect(tooltip.style.maxWidth).toBe('364px')
		expect(tooltip.style.visibility).toBe('visible')
		fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
		expect(screen.queryByRole('tooltip')).toBeNull()
	})
})

describe('aeroCRM application shell', () => {
	it('uses the canonical planner route consistently in desktop and mobile navigation', () => {
		fixture.pathname = '/planner'
		mount()
		const desktopLink = within(mainNavigation()).getByRole('link', {
			name: 'Планировщик'
		})
		expect(desktopLink.getAttribute('href')).toBe('/planner')
		expect(desktopLink.getAttribute('aria-current')).toBe('page')
		const context = document.querySelector(
			'[aria-label="Текущий раздел"]'
		)!
		expect(
			within(context as HTMLElement).getByText('Планировщик')
		).toBeTruthy()
		fireEvent.click(
			screen.getByRole('button', { name: 'Открыть навигацию CRM' })
		)
		const mobileLink = within(
			screen.getByRole('navigation', {
				name: 'Мобильная навигация CRM'
			})
		).getByRole('link', { name: 'Планировщик' })
		expect(mobileLink.getAttribute('href')).toBe('/planner')
		expect(mobileLink.getAttribute('aria-current')).toBe('page')
		expect(screen.queryByText('Мой день')).toBeNull()
	})
	it('shows optional workspace branding below both logos without changing the section or logo', () => {
		fixture.companyName = 'Студия Север'
		const view = mount()
		expect(screen.getAllByText('Студия Север')).toHaveLength(2)
		for (const caption of screen.getAllByText('Студия Север')) {
			expect(caption.title).toBe('Студия Север')
			expect(
				caption.previousElementSibling?.querySelector('svg')
			).toBeTruthy()
		}
		fixture.companyName = null
		view.rerender(
			<CrmAppShell>
				<h1>Контент</h1>
			</CrmAppShell>
		)
		expect(screen.queryByText('Студия Север')).toBeNull()
		expect(mainNavigation()).toBeTruthy()
	})
	it('collapses and reopens the desktop sidebar without hiding the control or main content', () => {
		mount()
		const sidebar = screen.getByRole('complementary', { name: 'CRM' })
		const toggle = screen.getByRole('button', {
			name: 'Свернуть боковую панель'
		})
		expect(toggle.getAttribute('aria-controls')).toBe(sidebar.id)
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
		expect(sidebar.hasAttribute('inert')).toBe(false)
		fireEvent.click(toggle)
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
		expect(toggle.getAttribute('aria-label')).toBe(
			'Развернуть боковую панель'
		)
		expect(sidebar.hasAttribute('inert')).toBe(true)
		expect(sidebar.getAttribute('aria-hidden')).toBe('true')
		expect(
			screen.queryByRole('navigation', { name: 'Основная навигация CRM' })
		).toBeNull()
		expect(document.activeElement).toBe(toggle)
		expect(sidebar.contains(toggle)).toBe(false)
		expect(screen.getByRole('main').textContent).toContain(
			'Содержимое раздела'
		)
		fireEvent.click(toggle)
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
		expect(sidebar.hasAttribute('inert')).toBe(false)
		expect(sidebar.hasAttribute('aria-hidden')).toBe(false)
		expect(mainNavigation()).toBeTruthy()
		expect(toast).not.toHaveBeenCalled()
	})
	it('preserves desktop collapse on navigation and keeps the mobile drawer independent', () => {
		const view = mount()
		fireEvent.click(
			screen.getByRole('button', { name: 'Свернуть боковую панель' })
		)
		fixture.pathname = '/tasks'
		view.rerender(
			<CrmAppShell>
				<h1>Задачи сегодня</h1>
			</CrmAppShell>
		)
		expect(
			screen
				.getByRole('button', { name: 'Развернуть боковую панель' })
				.getAttribute('aria-expanded')
		).toBe('false')
		fireEvent.click(
			screen.getByRole('button', { name: 'Открыть навигацию CRM' })
		)
		const mobileNavigation = screen.getByRole('navigation', {
			name: 'Мобильная навигация CRM'
		})
		expect(
			within(mobileNavigation)
				.getByRole('link', { name: 'Задачи' })
				.getAttribute('aria-current')
		).toBe('page')
		expect(mobileNavigation.closest('[inert]')).toBeNull()
		fireEvent.click(
			within(mobileNavigation).getByRole('link', { name: 'Входящие' })
		)
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(
			screen
				.getByRole('button', { name: 'Развернуть боковую панель' })
				.getAttribute('aria-expanded')
		).toBe('false')
	})
	it('includes the compact vector brand in the mobile section context', () => {
		mount()
		const context = document.querySelector(
			'[aria-label="Текущий раздел"]'
		)!
		expect(context.querySelector('svg')?.getAttribute('viewBox')).toBe(
			'0 0 286 66'
		)
		expect(
			within(context as HTMLElement).getByText('Входящие')
		).toBeTruthy()
	})
	it('shows current access and membership without demo copy, fake search or paid claims', () => {
		mount()
		expect(screen.getByText('Доступ активен')).toBeTruthy()
		expect(screen.getByText('Владелец пространства')).toBeTruthy()
		expect(screen.queryByRole('search')).toBeNull()
		expect(screen.queryByRole('searchbox')).toBeNull()
		expect(document.body.textContent).not.toMatch(
			/демо|прототип|Оплачено/i
		)
		expect(
			screen
				.getByRole('link', { name: 'Перейти к содержимому' })
				.getAttribute('href')
		).toBe('#crm-main-content')
		expect(screen.getByRole('main').getAttribute('id')).toBe(
			'crm-main-content'
		)
	})
	it('does not invent a CRM role for workspace members', () => {
		fixture.access.membership.role = 'MEMBER'
		mount()
		expect(screen.getByText('Участник пространства')).toBeTruthy()
		expect(document.body.textContent).not.toMatch(
			/CRM_ADMIN|Менеджер|Администратор/
		)
	})
	it('preserves GRACE status, allowance and backend deadline', () => {
		fixture.access.state = 'GRACE'
		mount()
		expect(screen.getByText('Льготный период')).toBeTruthy()
		expect(screen.getByText('Дополнительные 3 дня доступа')).toBeTruthy()
		expect(document.querySelector('time')?.getAttribute('datetime')).toBe(
			fixture.access.entitlement.graceUntil
		)
		expect(screen.queryByText('Доступ активен')).toBeNull()
	})
	it('preserves READ_ONLY explanation and visible section contents', () => {
		fixture.access.state = 'READ_ONLY'
		fixture.access.isReadOnly = true
		mount()
		expect(screen.getByText('Только чтение')).toBeTruthy()
		expect(
			screen.getByText('aeroCRM доступна только для чтения')
		).toBeTruthy()
		expect(
			screen.getByRole('heading', { name: 'Содержимое раздела' })
		).toBeTruthy()
	})
	it('resolves nested sections and preserves active navigation', () => {
		fixture.pathname = '/contacts/companies'
		mount()
		expect(
			within(mainNavigation())
				.getByRole('link', { name: 'Контакты' })
				.getAttribute('aria-current')
		).toBe('page')
		expect(
			document.querySelector('[aria-label="Текущий раздел"]')?.textContent
		).toContain('Контакты')
	})
	it('uses a neutral context for unknown paths, never a fabricated workspace name', () => {
		fixture.pathname = '/unknown'
		mount()
		expect(
			document.querySelector('[aria-label="Текущий раздел"]')?.textContent
		).toContain('Рабочее пространство')
	})
	it('navigates without redundant transition notifications', () => {
		mount()
		fireEvent.click(
			within(mainNavigation()).getByRole('link', { name: 'Входящие' })
		)
		fireEvent.click(
			within(mainNavigation()).getByRole('link', { name: 'Задачи' }),
			{ ctrlKey: true }
		)
		expect(toast).not.toHaveBeenCalled()
		fireEvent.click(
			within(mainNavigation()).getByRole('link', { name: 'Задачи' })
		)
		expect(toast).not.toHaveBeenCalled()
	})
	it('keeps accessible mobile navigation and closes the drawer on ordinary navigation', () => {
		mount()
		const toggle = screen.getByRole('button', {
			name: 'Открыть навигацию CRM'
		})
		fireEvent.click(toggle)
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
		const navigation = screen.getByRole('navigation', {
			name: 'Мобильная навигация CRM'
		})
		fireEvent.click(
			within(navigation).getByRole('link', { name: 'Сделки' }),
			{ metaKey: true }
		)
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
		fireEvent.click(
			within(navigation).getByRole('link', { name: 'Сделки' })
		)
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(toast).not.toHaveBeenCalled()
	})
})
