import { InboxScreen } from '@/screens/inbox'
import type { Metadata } from 'next'
import { isUuidV4 } from '@/shared/lib/contract'

export const metadata: Metadata = {
	title: 'Входящие'
}

const InboxPage = async ({
	searchParams
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>
}) => {
	const { entry } = await searchParams
	return <InboxScreen initialEntryId={isUuidV4(entry) ? entry : null} />
}

export default InboxPage
