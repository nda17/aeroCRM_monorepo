import { axiosInterceptorsRequest } from '@/shared/api'
import type {
	TelegramWebhookInstallResult,
	TelegramWebhookStatus
} from '@/features/manage-telegram-bot'

export interface TelegramInfoAdminSettings {
	infoTelegramBotTokenConfigured: boolean
	infoTelegramBotUsernameConfigured: boolean
}

export const telegramInfoAdminService = {
	async getSettings(): Promise<TelegramInfoAdminSettings> {
		const { data } =
			await axiosInterceptorsRequest.get<TelegramInfoAdminSettings>(
				'/telegram-info/admin/settings'
			)
		return data
	},
	async getWebhookStatus(): Promise<TelegramWebhookStatus> {
		const { data } =
			await axiosInterceptorsRequest.get<TelegramWebhookStatus>(
				'/telegram-info/admin/info-webhook/status'
			)
		return data
	},
	async reinstallWebhook(): Promise<TelegramWebhookInstallResult> {
		const { data } =
			await axiosInterceptorsRequest.post<TelegramWebhookInstallResult>(
				'/telegram-info/admin/info-webhook/reinstall'
			)
		return data
	}
}
