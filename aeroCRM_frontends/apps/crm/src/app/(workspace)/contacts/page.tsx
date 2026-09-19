import { ContactsScreen } from '@/screens/contacts'
import type { Metadata } from 'next'
import { isUuidV4 } from '@/shared/lib/contract'

export const metadata: Metadata = {
	title: 'Контакты'
}

const ContactsPage = async ({
	searchParams
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>
}) => {
	const { contactId } = await searchParams
	const initialContactId = isUuidV4(contactId) ? contactId : null
	return (
		<ContactsScreen
			key={initialContactId ?? 'contacts'}
			initialContactId={initialContactId}
		/>
	)
}

export default ContactsPage
