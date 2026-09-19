import { axiosInterceptorsRequest } from '@/shared/api'

export interface LegalPage {
	slug: string
	content: string
	updatedAt: string
}

const legalPagesService = {
	async getAll(): Promise<LegalPage[]> {
		const { data } = await axiosInterceptorsRequest.get('/legal-pages')
		return data
	},

	async getBySlug(slug: string): Promise<LegalPage> {
		const { data } = await axiosInterceptorsRequest.get(
			`/legal-pages/${slug}`
		)
		return data
	},

	async update(slug: string, content: string): Promise<LegalPage> {
		const { data } = await axiosInterceptorsRequest.patch(
			`/legal-pages/${slug}`,
			{ content }
		)
		return data
	}
}

export default legalPagesService
