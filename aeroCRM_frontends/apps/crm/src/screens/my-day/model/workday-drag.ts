import { useSyncExternalStore } from 'react'
import type { KeyboardCoordinateGetter } from '@dnd-kit/core'
import { WORKDAY_BOARD_STATUSES } from './workday-view'

export const workdayKeyboardCoordinates: KeyboardCoordinateGetter = (
	event,
	{ context, currentCoordinates }
) => {
	const direction = ['ArrowRight', 'ArrowDown'].includes(event.code)
		? 1
		: ['ArrowLeft', 'ArrowUp'].includes(event.code)
			? -1
			: 0
	if (!direction || !context.collisionRect) return
	event.preventDefault()
	const current =
		context.over?.id ?? context.active?.data.current?.task?.status
	const index = WORKDAY_BOARD_STATUSES.findIndex(
		status => status === current
	)
	if (index < 0) return
	for (
		let next = index + direction;
		next >= 0 && next < WORKDAY_BOARD_STATUSES.length;
		next += direction
	) {
		const target = WORKDAY_BOARD_STATUSES[next]
		const container = context.droppableContainers.get(target)
		const rect = context.droppableRects.get(target)
		if (
			!container ||
			container.disabled ||
			!rect ||
			rect.width <= 0 ||
			rect.height <= 0
		)
			continue
		return {
			x:
				currentCoordinates.x +
				rect.left +
				rect.width / 2 -
				(context.collisionRect.left + context.collisionRect.width / 2),
			y:
				currentCoordinates.y +
				rect.top +
				Math.min(100, rect.height / 2) -
				(context.collisionRect.top + context.collisionRect.height / 2)
		}
	}
}

const query = '(prefers-reduced-motion: reduce)'
const subscribe = (callback: () => void) => {
	const media = window.matchMedia?.(query)
	media?.addEventListener('change', callback)
	return () => media?.removeEventListener('change', callback)
}
export const useWorkdayReducedMotion = () =>
	useSyncExternalStore(
		subscribe,
		() => window.matchMedia?.(query).matches ?? false,
		() => true
	)
