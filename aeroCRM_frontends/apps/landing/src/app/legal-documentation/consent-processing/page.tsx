import { LegalPageContent } from '@/screens/legal-documentation'
import { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Согласие на обработку персональных данных',
	description: 'Согласие на обработку персональных данных aeroCRM.ru'
}

async function fetchContent(): Promise<string> {
	const res = await fetch(
		`${process.env.NEXT_PUBLIC_API_URL}/legal-pages/consent-processing`,
		{ cache: 'no-store' }
	)
	if (!res.ok) {
		throw new Error('Consent document is temporarily unavailable')
	}
	const data: unknown = await res.json()
	const content =
		typeof data === 'object' &&
		data !== null &&
		'content' in data &&
		typeof data.content === 'string'
			? data.content.trim()
			: ''
	if (!content) {
		throw new Error('Consent document content is empty')
	}
	return content
}

const ConsentProcessingPage = async () => {
	const content = await fetchContent()
	return <LegalPageContent html={content} />
}

export default ConsentProcessingPage
