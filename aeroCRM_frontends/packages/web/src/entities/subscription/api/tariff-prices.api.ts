import {
	axiosClassicRequest,
	axiosInterceptorsRequest
} from '@/shared/api'
import type {
	TariffPrice,
	TariffPriceInput
} from '@/entities/subscription/model/tariff-prices.types'

const tariffPricesService = {
	async get(): Promise<TariffPrice[]> {
		const { data } = await axiosClassicRequest.get('/tariff-prices')
		return data
	},

	async update(prices: TariffPriceInput[]): Promise<TariffPrice[]> {
		const { data } = await axiosInterceptorsRequest.patch(
			'/tariff-prices',
			{ prices }
		)
		return data
	}
}

export default tariffPricesService
