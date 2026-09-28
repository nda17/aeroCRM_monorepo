import type { Metadata } from 'next'
import { MailWorkspaceScreen } from '@/features/manage-mail/ui/MailWorkspaceScreen'

export const metadata: Metadata = { title: 'Почта' }

export default function MailPage() {
	return <MailWorkspaceScreen />
}
