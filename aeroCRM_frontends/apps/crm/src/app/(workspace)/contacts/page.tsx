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
	const { contactId, mailMessageId } = await searchParams
	const initialContactId = isUuidV4(contactId) ? contactId : null
	const initialMailMessageId =
		initialContactId && isUuidV4(mailMessageId) ? mailMessageId : null
	return (
		<ContactsScreen
			key={`${initialContactId ?? 'contacts'}:${initialMailMessageId ?? ''}`}
			initialContactId={initialContactId}
			initialMailMessageId={initialMailMessageId}
		/>
	)
}

export default ContactsPage
