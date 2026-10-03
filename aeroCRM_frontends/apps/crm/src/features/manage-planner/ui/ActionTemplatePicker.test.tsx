import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePlannerSettings } from '@/entities/crm-planner/model/use-planner-settings'
import { ActionTemplatePicker } from './ActionTemplatePicker'

vi.mock('@/entities/crm-planner/model/use-planner-settings', () => ({
	usePlannerSettings: vi.fn()
}))

describe('ActionTemplatePicker', () => {
	it('offers active workspace templates only and selects without saving', () => {
		const onSelect = vi.fn()
		vi.mocked(usePlannerSettings).mockReturnValue({
			context: { canRead: true, current: () => true },
			query: { isError: false, isFetching: false },
			data: {
				templates: [
					{ id: 'a', title: 'Позвонить клиенту', archived: false },
					{ id: 'b', title: 'Старый шаблон', archived: true }
				]
			}
		} as never)
		render(<ActionTemplatePicker onSelect={onSelect} />)
		fireEvent.click(
			screen.getByRole('button', { name: 'Позвонить клиенту' })
		)
		expect(onSelect).toHaveBeenCalledExactlyOnceWith('Позвонить клиенту')
		expect(
			screen.queryByRole('button', { name: 'Старый шаблон' })
		).toBeNull()
	})
})
