import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import React, { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirtyFormProvider, useDirtyForm, useGuardedRouter } from './index'
import { Drawer } from '@/shared/ui/drawer/Drawer'

const router = vi.hoisted(() => ({
	push: vi.fn(),
	replace: vi.fn(),
	back: vi.fn(),
	forward: vi.fn()
}))

vi.mock('next/navigation', () => ({ useRouter: () => router }))

const FormProbe = ({ onDiscard }: { onDiscard: () => void }) => {
	const [value, setValue] = useState('')
	const { confirmDiscard } = useDirtyForm({
		dirty: value.length > 0,
		label: 'Состав сделки'
	})
	const guardedRouter = useGuardedRouter()
	return (
		<div>
			<label>
				Черновик
				<input
					value={value}
					onChange={event => setValue(event.target.value)}
				/>
			</label>
			<button onClick={() => confirmDiscard(onDiscard)}>
				Покинуть форму
			</button>
			<button onClick={() => guardedRouter.back()}>Назад</button>
		</div>
	)
}

const NestedDrawerProbe = ({ onClose }: { onClose: () => void }) => {
	const [historyOpen, setHistoryOpen] = useState(false)
	return (
		<Drawer
			isOpen
			title="Сделка"
			onClose={onClose}
			closeLabel="Закрыть сделку"
		>
			<ParentDraftContent
				historyOpen={historyOpen}
				openHistory={() => setHistoryOpen(true)}
				closeHistory={() => setHistoryOpen(false)}
			/>
		</Drawer>
	)
}

const ParentDraftContent = ({
	historyOpen,
	openHistory,
	closeHistory
}: {
	historyOpen: boolean
	openHistory: () => void
	closeHistory: () => void
}) => {
	const [value, setValue] = useState('')
	useDirtyForm({ dirty: value.length > 0, label: 'Состав сделки' })
	return (
		<div>
			<label>
				Черновик
				<input
					value={value}
					onChange={event => setValue(event.target.value)}
				/>
			</label>
			<button onClick={openHistory}>Открыть историю</button>
			{historyOpen ? (
				<Drawer
					isOpen
					title="История состава"
					onClose={closeHistory}
					closeLabel="Закрыть историю"
				>
					<p>История доступна только для чтения.</p>
				</Drawer>
			) : null}
		</div>
	)
}

const mount = (owner: string | null, onDiscard = vi.fn()) =>
	render(
		<DirtyFormProvider owner={owner}>
			<FormProbe onDiscard={onDiscard} />
		</DirtyFormProvider>
	)

beforeEach(() => {
	vi.clearAllMocks()
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
	delete (window as Window & { navigation?: unknown }).navigation
})

describe('dirty form guard', () => {
	it('allows navigation and beforeunload without prompting when the form is unchanged', () => {
		mount('actor:1')
		fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
		expect(router.back).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole('dialog')).toBeNull()

		const unload = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(unload)
		expect(unload.defaultPrevented).toBe(false)
	})

	it('keeps a changed draft when the user continues editing and only navigates after discard', async () => {
		const onDiscard = vi.fn()
		mount('actor:1', onDiscard)
		fireEvent.change(screen.getByRole('textbox', { name: 'Черновик' }), {
			target: { value: 'Новая позиция' }
		})
		await waitFor(() => {
			const unload = new Event('beforeunload', { cancelable: true })
			window.dispatchEvent(unload)
			expect(unload.defaultPrevented).toBe(true)
		})

		fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
		expect(
			screen.getByRole('dialog', { name: 'Несохранённые изменения' })
		).toBeTruthy()
		expect(router.back).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Продолжить редактирование' })
		)
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(
			screen.getByRole('textbox', { name: 'Черновик' })
		).toHaveProperty('value', 'Новая позиция')
		expect(onDiscard).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: 'Покинуть форму' }))
		fireEvent.click(
			screen.getByRole('button', { name: 'Отбросить изменения' })
		)
		expect(onDiscard).toHaveBeenCalledTimes(1)
		expect(
			screen.getByRole('textbox', { name: 'Черновик' })
		).toHaveProperty('value', 'Новая позиция')
	})

	it('does not replay a pending navigation after the account owner changes', async () => {
		const onDiscard = vi.fn()
		const view = mount('actor:1', onDiscard)
		fireEvent.change(screen.getByRole('textbox', { name: 'Черновик' }), {
			target: { value: 'Личные данные' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
		await screen.findByRole('dialog', { name: 'Несохранённые изменения' })

		view.rerender(
			<DirtyFormProvider owner="actor:2">
				<FormProbe onDiscard={onDiscard} />
			</DirtyFormProvider>
		)
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
		expect(router.back).not.toHaveBeenCalled()
		expect(onDiscard).not.toHaveBeenCalled()
	})

	it('holds browser Back until the user chooses whether to discard the draft', async () => {
		const navigation = Object.assign(new EventTarget(), {
			traverseTo: vi.fn()
		})
		Object.defineProperty(window, 'navigation', {
			configurable: true,
			value: navigation
		})
		mount('actor:1')
		fireEvent.change(screen.getByRole('textbox', { name: 'Черновик' }), {
			target: { value: 'Черновой состав' }
		})

		const back = Object.assign(
			new Event('navigate', { cancelable: true }),
			{
				navigationType: 'traverse',
				destination: { key: 'previous-entry', sameDocument: true }
			}
		)
		act(() => navigation.dispatchEvent(back))
		expect(back.defaultPrevented).toBe(true)
		expect(navigation.traverseTo).not.toHaveBeenCalled()
		await screen.findByRole('dialog', { name: 'Несохранённые изменения' })

		fireEvent.click(
			screen.getByRole('button', { name: 'Отбросить изменения' })
		)
		expect(navigation.traverseTo).toHaveBeenCalledWith('previous-entry')
	})

	it('closes a clean nested drawer without clearing or bypassing the parent draft guard', async () => {
		const onClose = vi.fn()
		render(
			<DirtyFormProvider owner="actor:1">
				<NestedDrawerProbe onClose={onClose} />
			</DirtyFormProvider>
		)
		fireEvent.change(screen.getByRole('textbox', { name: 'Черновик' }), {
			target: { value: 'Сохранить состав позже' }
		})
		fireEvent.click(
			screen.getByRole('button', { name: 'Открыть историю' })
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Закрыть историю' })
		)
		expect(
			screen.queryByRole('dialog', { name: 'Несохранённые изменения' })
		).toBeNull()
		expect(
			screen.getByRole('textbox', { name: 'Черновик' })
		).toHaveProperty('value', 'Сохранить состав позже')

		fireEvent.click(screen.getByRole('button', { name: 'Закрыть сделку' }))
		await screen.findByText('Несохранённые изменения')
		expect(onClose).not.toHaveBeenCalled()
	})
})
