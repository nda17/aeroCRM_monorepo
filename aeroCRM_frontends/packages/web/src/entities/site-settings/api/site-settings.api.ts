import { axiosInterceptorsRequest } from '@/shared/api'
import type { SiteSettings } from '@/entities/site-settings/model/site-settings.types'

const siteSettingsService = {
	async get(): Promise<SiteSettings> {
		const { data } = await axiosInterceptorsRequest.get('/site-settings')
		return data
	},

	async update(
		payload: Partial<
			Pick<
				SiteSettings,
				'bannerEnabled' | 'bannerText' | 'snowflakeEnabled'
			>
		>
	): Promise<SiteSettings> {
		const { data } = await axiosInterceptorsRequest.patch(
			'/site-settings',
			payload
		)
		return data
	}
}

export default siteSettingsService
