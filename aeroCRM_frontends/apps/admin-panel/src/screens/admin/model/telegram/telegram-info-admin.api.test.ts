import { afterEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn()
}))

vi.mock('@/shared/api', () => ({
	axiosInterceptorsRequest: request
}))

import { telegramInfoAdminService } from './telegram-info-admin.api'

describe('telegramInfoAdminService', () => {
	afterEach(() => vi.clearAllMocks())

	it('uses the INFO bot admin settings and webhook endpoints', async () => {
		request.get
			.mockResolvedValueOnce({ data: { infoTelegramBotTokenConfigured: true } })
			.mockResolvedValueOnce({ data: { bot: 'info', configured: true } })
		request.post.mockResolvedValueOnce({ data: { title: 'INFO-бот' } })

		await expect(telegramInfoAdminService.getSettings()).resolves.toEqual({
			infoTelegramBotTokenConfigured: true
		})
		await expect(telegramInfoAdminService.getWebhookStatus()).resolves.toEqual({
			bot: 'info',
			configured: true
		})
		await expect(telegramInfoAdminService.reinstallWebhook()).resolves.toEqual({
			title: 'INFO-бот'
		})

		expect(request.get.mock.calls).toEqual([
			['/telegram-info/admin/settings'],
			['/telegram-info/admin/info-webhook/status']
		])
		expect(request.post).toHaveBeenCalledExactlyOnceWith(
			'/telegram-info/admin/info-webhook/reinstall'
		)
	})
})
