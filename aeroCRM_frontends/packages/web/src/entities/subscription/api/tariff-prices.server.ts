import 'server-only'

import { API_URL } from '@/shared/config/api.config'
import type { TariffPrice } from '@/entities/subscription/model/tariff-prices.types'
import { cache } from 'react'

export const TARIFF_PRICES_TAG = 'tariff-prices'

export const getTariffPrices = cache(
	async (): Promise<TariffPrice[] | null> => {
		try {
			const response = await fetch(`${API_URL}/tariff-prices`, {
				next: { revalidate: 60, tags: [TARIFF_PRICES_TAG] }
			})

			if (!response.ok) {
				return null
			}

			return (await response.json()) as TariffPrice[]
		} catch (error) {
			console.error('Failed to load tariff prices on server', error)
			return null
		}
	}
)
