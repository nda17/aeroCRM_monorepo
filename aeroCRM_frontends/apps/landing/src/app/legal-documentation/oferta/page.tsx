import { LegalPageContent } from '@/screens/legal-documentation'
import { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Публичная оферта',
	description: 'Публичная оферта aeroCRM на aerocrm.space',
	alternates: { canonical: 'https://aerocrm.space/legal-documentation/oferta' }
}

async function fetchContent(): Promise<string> {
	try {
		const res = await fetch(
			`${process.env.NEXT_PUBLIC_API_URL}/legal-pages/oferta`,
			{ next: { revalidate: 60 } }
		)
		if (!res.ok) return ''
		const data = await res.json()
		return data?.content ?? ''
	} catch {
		return ''
	}
}

const OfertaPage = async () => {
	const content = await fetchContent()
	return <LegalPageContent html={content} />
}

export default OfertaPage
