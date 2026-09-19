import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { TeamEditor } from './TeamEditor'
import type { useTeamSession } from '../model/use-team-session'

const command = vi.hoisted(() => ({
	locked: false,
	running: false,
	enabled: true,
	uncertain: false,
	blocked: false,
	error: null,
	execute: vi.fn(),
	canClose: vi.fn(() => true),
	resetAfterReview: vi.fn()
}))
vi.mock('../model/use-team-command', () => ({
	useTeamCommand: () => command
}))
vi.mock('./TeamPicker', () => ({
	TeamPicker: () => <div>Выбор отдела</div>
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { error: vi.fn() })
}))
const context = { permissions: { data: { role: 'OWNER' } } } as ReturnType<
	typeof useTeamSession
>
const mount = () =>
	render(
		<TeamEditor
			context={context}
			selection={{ kind: 'invite' }}
			onClose={vi.fn()}
			onSaved={vi.fn()}
			onReview={async () => undefined}
		/>
	)
beforeEach(() => {
	vi.clearAllMocks()
	command.locked = false
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
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})
describe('employee invitation names', () => {
	it('uses separate name fields and sends normalized names in the same invitation command', () => {
		mount()
		fireEvent.change(screen.getByRole('textbox', { name: 'Фамилия' }), {
			target: { value: ' Петров ' }
		})
		fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
			target: { value: ' Иван ' }
		})
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Email сотрудника' }),
			{
				target: { value: 'employee@example.test' }
			}
		)
		fireEvent.submit(
			screen
				.getByRole('button', { name: 'Создать приглашение' })
				.closest('form')!
		)
		expect(command.execute).toHaveBeenCalledWith({
			kind: 'invite',
			email: 'employee@example.test',
			role: 'MANAGER',
			teamIds: [],
			ttlDays: 7,
			profile: { firstName: 'Иван', lastName: 'Петров', middleName: null }
		})
	})
	it('does not submit an incomplete name even when native validation is bypassed', () => {
		mount()
		fireEvent.submit(
			screen
				.getByRole('button', { name: 'Создать приглашение' })
				.closest('form')!
		)
		expect(command.execute).not.toHaveBeenCalled()
		expect(screen.getByRole('alert').textContent).toContain(
			'Проверьте имя и фамилию'
		)
		expect(toast.error).toHaveBeenCalledTimes(1)
	})
	it('locks all name fields while the original command is unresolved', () => {
		command.locked = true
		mount()
		for (const label of ['Фамилия', 'Имя', 'Отчество (необязательно)'])
			expect(
				(screen.getByRole('textbox', { name: label }) as HTMLInputElement)
					.disabled
			).toBe(true)
		fireEvent.submit(
			screen
				.getByRole('button', { name: 'Создать приглашение' })
				.closest('form')!
		)
		expect(command.execute).not.toHaveBeenCalled()
	})
})
