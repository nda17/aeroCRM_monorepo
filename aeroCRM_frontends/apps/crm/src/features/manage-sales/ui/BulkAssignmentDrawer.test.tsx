import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BulkAssignmentDrawer } from './BulkAssignmentDrawer'

const mocks = vi.hoisted(() => ({
	previewAssignment: vi.fn(),
	useWorkdaySession: vi.fn(),
	useAssigneeOptions: vi.fn(),
	useMemoryCommand: vi.fn()
}))
vi.mock('@/entities/crm-workday', () => ({
	useWorkdaySession: mocks.useWorkdaySession
}))
vi.mock('@/entities/crm-team', () => ({
	useAssigneeOptions: mocks.useAssigneeOptions,
	AssigneeSelect: ({
		onChange
	}: {
		onChange: (option: { subject: string; membershipId: string }) => void
	}) => (
		<button
			onClick={() =>
				onChange({
					subject: 'target-user',
					membershipId: '66666666-6666-4666-8666-666666666666'
				})
			}
		>
			Выбрать целевого сотрудника
		</button>
	)
}))
vi.mock('@/entities/sales/api/sales-productivity.api', () => ({
	previewAssignment: mocks.previewAssignment,
	applyAssignment: vi.fn()
}))
vi.mock('@/shared/lib/pending-command', () => ({
	commandOwner: vi.fn(() => ({ owner: 'actor', sessionRevision: 1 })),
	useMemoryCommand: mocks.useMemoryCommand
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const membershipId = '55555555-5555-4555-8555-555555555555'
const dealId = '22222222-2222-4222-8222-222222222222'
const targetMembershipId = '66666666-6666-4666-8666-666666666666'

describe('BulkAssignmentDrawer preview', () => {
	it('shows the first successful preview while the command coordinator is idle', async () => {
		const context = {
			key: [workspaceId, 'actor', 1],
			scopeKey: 'actor-scope',
			workspace: { workspaceId, membership: { membershipId } },
			session: { userId: 'actor', accessToken: 'token' },
			sessionRevision: 1,
			permissions: { data: { role: 'CRM_USER' } },
			canRead: true,
			canWrite: true,
			current: () => true,
			authorize: vi.fn().mockResolvedValue('token')
		}
		mocks.useWorkdaySession.mockReturnValue(context)
		mocks.useAssigneeOptions.mockReturnValue({
			resolveBinding: () => ({
				subject: 'target-user',
				membershipId: targetMembershipId
			})
		})
		mocks.previewAssignment.mockResolvedValue({
			schemaVersion: 1,
			workspaceId,
			actorSubject: 'actor',
			actorMembershipId: membershipId,
			assignee: {
				subject: 'target-user',
				membershipId: targetMembershipId
			},
			previewHash: 'a'.repeat(64),
			deals: [
				{
					id: dealId,
					expectedVersion: 4,
					title: 'Тестовая сделка',
					fromSubject: 'old-user',
					transferredTaskCount: 2,
					retainedTaskCount: 0
				}
			],
			transferredTaskCount: 2,
			retainedTaskCount: 0
		})
		// Coordinator reset returns false for an idle command: no rejected entry existed to clear.
		mocks.useMemoryCommand.mockReturnValue({
			reset: () => false,
			error: null,
			uncertain: false,
			locked: false,
			running: false,
			execute: vi.fn(),
			snapshot: { status: 'idle' }
		})
		const client = new QueryClient()
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
		render(
			<QueryClientProvider client={client}>
				<BulkAssignmentDrawer
					deals={[{ id: dealId, expectedVersion: 4 }]}
					onClose={vi.fn()}
					onAssigned={vi.fn()}
				/>
			</QueryClientProvider>
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Выбрать целевого сотрудника' })
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Показать изменения' })
		)
		expect(await screen.findByText('Тестовая сделка')).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Подтвердить передачу 1 сделок' })
		).toBeTruthy()
		expect(mocks.previewAssignment).toHaveBeenCalledOnce()
	})
})
