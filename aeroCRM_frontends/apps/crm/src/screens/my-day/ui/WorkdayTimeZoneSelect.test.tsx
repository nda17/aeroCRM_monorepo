import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkdayTimeZoneSelect } from './WorkdayTimeZoneSelect'

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

describe('planner timezone select', () => {
	it('uses the shared accessible native select and keeps Vladivostok selected until explicit change', () => {
		const onChange = vi.fn()
		render(
			<WorkdayTimeZoneSelect
				value="Asia/Vladivostok"
				onChange={onChange}
			/>
		)
		const select = screen.getByRole('combobox', { name: 'Часовой пояс' })
		expect(select).toHaveProperty('value', 'Asia/Vladivostok')
		expect(select).toHaveProperty('disabled', false)
		expect(
			within(select).getByRole('option', { name: 'Владивосток' })
		).toHaveProperty('selected', true)
		expect(select.parentElement?.querySelectorAll('svg')).toHaveLength(1)
		expect(onChange).not.toHaveBeenCalled()
		select.focus()
		expect(document.activeElement).toBe(select)
		fireEvent.change(select, { target: { value: 'Europe/Moscow' } })
		expect(onChange).toHaveBeenCalledExactlyOnceWith('Europe/Moscow')
	})
	it.each(['US/Eastern', 'Etc/GMT-3', 'Antarctica/Troll'])(
		'keeps a saved valid alias/custom zone %s selectable without replacing it',
		value => {
			vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue([
				'Europe/Moscow'
			])
			const onChange = vi.fn()
			render(<WorkdayTimeZoneSelect value={value} onChange={onChange} />)
			expect(screen.getByLabelText('Часовой пояс')).toHaveProperty(
				'value',
				value
			)
			expect(screen.getByRole('option', { name: value })).toHaveProperty(
				'disabled',
				false
			)
			expect(onChange).not.toHaveBeenCalled()
		}
	)
	it('rejects a forged unknown option and a disabled invalid saved value', () => {
		const onChange = vi.fn()
		render(<WorkdayTimeZoneSelect value="unknown" onChange={onChange} />)
		const select = screen.getByLabelText('Часовой пояс')
		expect(screen.getByRole('option', { name: 'unknown' })).toHaveProperty(
			'disabled',
			true
		)
		expect(select.getAttribute('aria-invalid')).toBe('true')
		fireEvent.change(select, { target: { value: 'unknown' } })
		fireEvent.change(select, { target: { value: 'not/in-list' } })
		expect(onChange).not.toHaveBeenCalled()
		expect(screen.getByRole('alert').textContent).toContain('IANA')
	})
	it('hydrates the deterministic server choices before adding the full client catalog', async () => {
		const supported = vi
			.spyOn(Intl, 'supportedValuesOf')
			.mockImplementation(() => {
				throw Error('Must not run during SSR')
			})
		const onChange = vi.fn()
		const component = (
			<WorkdayTimeZoneSelect value="US/Eastern" onChange={onChange} />
		)
		const html = renderToString(component)
		expect(supported).not.toHaveBeenCalled()
		expect(html).not.toContain('Antarctica/Casey')
		supported.mockReturnValue(['Antarctica/Casey'])
		const container = document.createElement('div')
		container.innerHTML = html
		document.body.append(container)
		const onRecoverableError = vi.fn()
		let root: ReturnType<typeof hydrateRoot> | undefined
		try {
			await act(async () => {
				root = hydrateRoot(container, component, { onRecoverableError })
			})
			await waitFor(() =>
				expect(
					within(container).getByRole('option', {
						name: 'Antarctica/Casey'
					})
				).toBeTruthy()
			)
			expect(
				within(container).getByLabelText('Часовой пояс')
			).toHaveProperty('value', 'US/Eastern')
			expect(onRecoverableError).not.toHaveBeenCalled()
			expect(onChange).not.toHaveBeenCalled()
		} finally {
			await act(async () => root?.unmount())
			container.remove()
		}
	})
})
