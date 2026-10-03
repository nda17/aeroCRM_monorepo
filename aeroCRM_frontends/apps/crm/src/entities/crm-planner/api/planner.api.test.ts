import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedRequest } from '@/shared/api/authenticated-http-client'
import { getPlannerSettings, savePlannerSettings } from './planner.api'
import type { SavePlannerSettingsCommand } from '../model/planner.types'

vi.mock('@/shared/api/authenticated-http-client', async () => ({
	...(await vi.importActual<
		typeof import('@/shared/api/authenticated-http-client')
	>('@/shared/api/authenticated-http-client')),
	authenticatedRequest: vi.fn()
}))
const request = vi.mocked(authenticatedRequest)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const command: SavePlannerSettingsCommand = {
	schemaVersion: 1,
	workspaceId,
	commandId: '22222222-2222-4222-8222-222222222222',
	expectedVersion: 2,
	templates: [],
	columns: [
		{
			id: 'OPEN',
			name: 'К выполнению',
			status: 'OPEN',
			isDefault: true,
			archived: false
		},
		{
			id: 'IN_PROGRESS',
			name: 'В работе',
			status: 'IN_PROGRESS',
			isDefault: true,
			archived: false
		},
		{
			id: 'COMPLETED',
			name: 'Готово',
			status: 'COMPLETED',
			isDefault: true,
			archived: false
		},
		{
			id: 'CANCELLED',
			name: 'Отменено',
			status: 'CANCELLED',
			isDefault: true,
			archived: false
		}
	]
}
const response = (version: number) => ({
	schemaVersion: 1,
	workspaceId,
	version,
	templates: command.templates,
	columns: command.columns
})

beforeEach(() => vi.clearAllMocks())

describe('Planner settings API', () => {
	it('reads settings without browser caching parameters beyond workspace binding', async () => {
		request.mockResolvedValue(response(2))
		await expect(
			getPlannerSettings('captured', workspaceId)
		).resolves.toEqual(response(2))
		expect(request).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'captured',
			method: 'GET',
			url: '/crm/sales/planner/settings',
			params: { workspaceId }
		})
	})

	it('writes the frozen workspace command with a matching idempotency key', async () => {
		request.mockResolvedValue(response(3))
		await expect(
			savePlannerSettings('captured', command)
		).resolves.toEqual(response(3))
		expect(request).toHaveBeenCalledExactlyOnceWith({
			accessToken: 'captured',
			method: 'POST',
			url: '/crm/sales/planner/settings',
			headers: { 'Idempotency-Key': command.commandId },
			data: command,
			mapError: expect.any(Function)
		})
	})

	it.each([
		[
			'crm_planner_settings_conflict',
			'Настройки планировщика изменились. Обновите данные и повторите попытку.'
		],
		[
			'crm_planner_column_unavailable',
			'Колонка планировщика недоступна. Обновите данные.'
		]
	])('maps known conflict %s to a safe message', async (code, message) => {
		request.mockResolvedValue(response(3))
		await savePlannerSettings('captured', command)
		const mapError = request.mock.calls[0][0].mapError!
		expect(
			mapError({
				isAxiosError: true,
				response: {
					status: 409,
					data: { code, message: 'upstream secret' }
				}
			})?.message
		).toBe(message)
		expect(
			mapError({
				isAxiosError: true,
				response: {
					status: 409,
					data: { code: 'unknown', message: 'private' }
				}
			})
		).toBeUndefined()
	})
})
