import type { Metadata } from 'next'
import { MessagesScreen } from '@/features/workspace-collaboration/ui/MessagesScreen'

export const metadata: Metadata = { title: 'Мессенджер' }
export default function MessagesPage() {
	return <MessagesScreen />
}
