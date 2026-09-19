import { axiosInterceptorsRequest } from '@/shared/api'
import { normalizeHomePageContent } from '@/entities/home-page-content/model/home-page-content.defaults'
import type {
	HomePageContentRecord,
	RawHomePageContent,
	StructuredHomePageContent
} from '@/entities/home-page-content/model/home-page-content.types'

interface HomePageContentApiRecord {
	id: string
	content: unknown
	updatedAt: string
}

const normalizeRecord = (
	record: HomePageContentApiRecord
): HomePageContentRecord => ({
	...record,
	content: normalizeHomePageContent(record.content)
})

const homePageContentService = {
	async get(): Promise<HomePageContentRecord> {
		const { data } =
			await axiosInterceptorsRequest.get<HomePageContentApiRecord>(
				'/home-page-content'
			)

		return normalizeRecord(data)
	},

	async updateStructured(
		content: StructuredHomePageContent
	): Promise<HomePageContentRecord> {
		const { data } =
			await axiosInterceptorsRequest.patch<HomePageContentApiRecord>(
				'/home-page-content',
				{ content }
			)

		return normalizeRecord(data)
	},

	async updateRaw(
		content: RawHomePageContent
	): Promise<HomePageContentRecord> {
		const { data } =
			await axiosInterceptorsRequest.patch<HomePageContentApiRecord>(
				'/home-page-content/raw-code',
				{ content }
			)

		return normalizeRecord(data)
	}
}

export default homePageContentService
