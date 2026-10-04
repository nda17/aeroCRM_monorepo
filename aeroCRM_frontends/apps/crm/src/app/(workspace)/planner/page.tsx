import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Задачи' }
export default async function PlannerPage({
	searchParams
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(await searchParams)) {
		if (Array.isArray(value))
			value.forEach(item => params.append(key, item))
		else if (value !== undefined) params.append(key, value)
	}
	redirect(`/tasks${params.size ? `?${params.toString()}` : ''}`)
}
