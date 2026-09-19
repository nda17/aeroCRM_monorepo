import { LegalPageContent } from '@/screens/legal-documentation'
import { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Политика обработки персональных данных',
	description: 'Политика обработки персональных данных aeroCRM на aerocrm.space',
	alternates: { canonical: 'https://aerocrm.space/legal-documentation/personal-policy' }
}

async function fetchContent(): Promise<string> {
	const res = await fetch(
		`${process.env.NEXT_PUBLIC_API_URL}/legal-pages/personal-policy`,
		{ cache: 'no-store' }
	)
	if (!res.ok) {
		throw new Error('Personal policy is temporarily unavailable')
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
		throw new Error('Personal policy content is empty')
	}
	return content
}

const PersonalPolicyPage = async () => {
	const content = await fetchContent()
	return <LegalPageContent html={content} />
}

export default PersonalPolicyPage
