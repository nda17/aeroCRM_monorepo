import type { Metadata } from 'next'
import { DirectoryScreen } from '@/features/workspace-collaboration/ui/DirectoryScreen'

export const metadata: Metadata = { title: 'Справочник' }
export default function DirectoryPage() {
	return <DirectoryScreen />
}
