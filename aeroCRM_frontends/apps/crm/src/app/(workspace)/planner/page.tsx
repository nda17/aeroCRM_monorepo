import type { Metadata } from 'next'
import { MyDayScreen } from '@/screens/my-day'
import { isUuidV4 } from '@/shared/lib/contract'

export const metadata: Metadata = { title: 'Планировщик' }
export default async function PlannerPage({
	searchParams
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
	const { task } = await searchParams
	return <MyDayScreen initialTaskId={isUuidV4(task) ? task : null} />
}
