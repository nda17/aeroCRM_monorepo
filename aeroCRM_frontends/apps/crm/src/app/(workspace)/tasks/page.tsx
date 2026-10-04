import type { Metadata } from 'next'
import { MyDayScreen } from '@/screens/my-day'
import { isUuidV4 } from '@/shared/lib/contract'

export const metadata: Metadata = {
	title: 'Задачи'
}

export default async function TasksPage({
	searchParams
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
	const { task } = await searchParams
	return <MyDayScreen initialTaskId={isUuidV4(task) ? task : null} />
}
