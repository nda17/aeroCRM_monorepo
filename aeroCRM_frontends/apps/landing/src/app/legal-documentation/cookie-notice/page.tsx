import { LegalPageContent } from '@/screens/legal-documentation'
import { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Политика в отношении файлов cookie',
	description: 'Политика в отношении файлов cookie aeroCRM на aerocrm.space',
	alternates: { canonical: 'https://aerocrm.space/legal-documentation/cookie-notice' },
	openGraph: {
		url: 'https://aerocrm.space/legal-documentation/cookie-notice',
		siteName: 'aeroCRM',
		locale: 'ru_RU',
		type: 'website',
		images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'aeroCRM' }]
	}
}

async function fetchContent(): Promise<string> {
	try {
		const res = await fetch(
			`${process.env.NEXT_PUBLIC_API_URL}/legal-pages/cookie-notice`,
			{ next: { revalidate: 60 } }
		)
		if (!res.ok) return ''
		const data = await res.json()
		return data?.content ?? ''
	} catch {
		return ''
	}
}

const CookieNoticePage = async () => {
	const content = await fetchContent()
	return <LegalPageContent html={content} />
}

export default CookieNoticePage
