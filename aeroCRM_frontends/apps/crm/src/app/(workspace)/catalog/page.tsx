import CatalogScreen from '@/screens/catalog/ui/CatalogScreen'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Каталог товаров и услуг' }

export default function CatalogPage() {
	return <CatalogScreen />
}
