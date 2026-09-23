import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HelpHint } from '../tooltip/use-tooltip'
import { TextField } from './TextField'

describe('TextField label help accessibility', () => {
	it('keeps the input label and hint associated when the help button sits beside the label', () => {
		const hint = 'Используется в названии кабинета.'
		const help = 'Название видно участникам рабочего пространства.'
		render(
			<TextField
				id="workspace-name"
				label="Название пространства"
				labelHelp={
					<HelpHint label="Название пространства" description={help} />
				}
				hint={hint}
			/>
		)

		const input = screen.getByRole('textbox', {
			name: 'Название пространства'
		})
		const label = document.querySelector<HTMLLabelElement>(
			'label[for="workspace-name"]'
		)
		const helpButton = screen.getByRole('button', {
			name: 'Пояснение: Название пространства'
		})

		expect(label).not.toBeNull()
		expect(label?.htmlFor).toBe(input.id)
		expect(label?.contains(helpButton)).toBe(false)
		const describedBy =
			input.getAttribute('aria-describedby')?.split(/\s+/) ?? []
		expect(
			describedBy.some(
				id => document.getElementById(id)?.textContent === hint
			)
		).toBe(true)

		fireEvent.focus(helpButton)
		expect(screen.getByRole('tooltip').textContent).toBe(help)
	})
})
