import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	parseMailTemplatesSnapshot,
	parseSavedMailTemplates
} from '@/entities/mail/model/mail-templates.contract'
import { RichMailEditor } from './RichMailEditor'
import { MailTemplatesDrawer } from './MailTemplatesDrawer'

const hooks = vi.hoisted(() => ({
	state: null as unknown,
	command: null as unknown
}))
vi.mock('../model/use-mail-templates', () => ({
	useMailTemplates: () => hooks.state
}))
vi.mock('../model/use-mail-context', () => ({
	useMailCommand: () => hooks.command
}))
vi.mock('@/entities/mail/api/mail-templates.api', () => ({
	saveMailTemplates: vi.fn()
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const templateId = '22222222-2222-4222-8222-222222222222'

afterEach(cleanup)

describe('mail template contracts and insertion', () => {
	it('parses snapshots and accepts only the normalized receipt for the command', () => {
		const command = {
			schemaVersion: 1 as const,
			workspaceId,
			commandId: '33333333-3333-4333-8333-333333333333',
			expectedVersion: 3,
			templates: [
				{
					id: templateId,
					title: ' Follow up ',
					subject: ' Next steps ',
					body: 'Hello\r\n\r\nThanks',
					archived: false
				}
			]
		}
		const snapshot = {
			schemaVersion: 1,
			workspaceId,
			version: 4,
			templates: [
				{
					id: templateId,
					title: 'Follow up',
					subject: 'Next steps',
					body: 'Hello\n\nThanks',
					archived: false
				}
			]
		}
		expect(parseMailTemplatesSnapshot(snapshot, workspaceId)).toEqual(
			snapshot
		)
		expect(parseSavedMailTemplates(snapshot, command)).toEqual(snapshot)
		expect(
			parseSavedMailTemplates({ ...snapshot, version: 5 }, command)
		).toBeNull()
		expect(
			parseSavedMailTemplates({ ...snapshot, templates: [] }, command)
		).toBeNull()
	})

	it('appends template text while retaining existing rich HTML formatting', async () => {
		const onChange = vi.fn()
		const view = render(
			<RichMailEditor text="" disabled={false} onChange={onChange} />
		)
		await screen.findByRole('textbox', { name: 'Письмо' })
		await act(async () => {
			view.rerender(
				<RichMailEditor
					text="Existing text"
					html="<p><strong>Existing text</strong></p>"
					disabled={false}
					onChange={onChange}
				/>
			)
		})
		await waitFor(() =>
			expect(
				screen.getByRole('textbox', { name: 'Письмо' }).innerHTML
			).toContain('<strong>Existing text</strong>')
		)
		await act(async () => {
			view.rerender(
				<RichMailEditor
					text="Existing text"
					html="<p><strong>Existing text</strong></p>"
					disabled={false}
					insertion={{ id: 'explicit-insert-1', text: 'Template body' }}
					onChange={onChange}
				/>
			)
		})
		await waitFor(() =>
			expect(onChange).toHaveBeenCalledWith(
				expect.objectContaining({
					text: 'Existing text\n\nTemplate body',
					html: expect.stringContaining('<strong>Existing text</strong>')
				})
			)
		)
	})

	it('hides template contents during permission refresh and restores the unsaved draft', () => {
		const template = {
			id: templateId,
			title: 'Existing title',
			subject: 'Existing subject',
			body: 'Existing body',
			archived: false
		}
		const snapshot = {
			schemaVersion: 1 as const,
			workspaceId,
			version: 1,
			templates: [template]
		}
		const context = {
			key: [workspaceId, 'actor', 1],
			workspace: {
				workspaceId,
				canWrite: true,
				membership: { role: 'CRM_ADMIN' }
			},
			capabilities: { isError: false, isFetching: false }
		}
		const query = {
			data: snapshot,
			isError: false,
			isFetching: false,
			refetch: vi.fn()
		}
		const state = {
			context,
			query,
			queryKey: ['mail-templates', workspaceId],
			canRead: true,
			canManage: true
		}
		hooks.state = state
		hooks.command = {
			locked: false,
			error: null,
			uncertain: false,
			running: false,
			execute: vi.fn(),
			reset: vi.fn(),
			snapshot: { status: 'idle' }
		}
		Object.defineProperties(HTMLDialogElement.prototype, {
			showModal: {
				configurable: true,
				value() {
					this.open = true
				}
			},
			close: {
				configurable: true,
				value() {
					this.open = false
				}
			}
		})
		const client = new QueryClient()
		const tree = () => (
			<QueryClientProvider client={client}>
				<MailTemplatesDrawer onClose={vi.fn()} />
			</QueryClientProvider>
		)
		const view = render(tree())
		const title = screen.getByRole('textbox', {
			name: 'Название шаблона 1'
		})
		fireEvent.change(title, { target: { value: 'Unsaved title' } })

		state.canRead = false
		state.canManage = false
		view.rerender(tree())
		expect(screen.getByRole('status').textContent).toContain(
			'Черновик сохранён'
		)
		expect(
			screen.queryByRole('textbox', { name: 'Название шаблона 1' })
		).toBeNull()

		state.canRead = true
		state.canManage = true
		view.rerender(tree())
		expect(
			screen.getByRole('textbox', { name: 'Название шаблона 1' })
		).toHaveProperty('value', 'Unsaved title')
	})
})
