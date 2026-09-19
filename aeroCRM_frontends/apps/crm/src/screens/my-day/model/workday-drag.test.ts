import { act, cleanup, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeyboardCoordinateGetter } from '@dnd-kit/core'
import {
	useWorkdayReducedMotion,
	workdayKeyboardCoordinates
} from './workday-drag'

type CoordinatesInput = Parameters<KeyboardCoordinateGetter>[1]
const rectangle = (left: number, top = 0, width = 300, height = 500) =>
	new DOMRect(left, top, width, height)
const input = (status = 'OPEN') => {
	// Pure coordinate-adapter tests only need the fields read by the getter.
	const context = {
		active: { data: { current: { task: { status } } } },
		over: null as { id: string } | null,
		collisionRect: rectangle(20, 80, 260, 160) as DOMRect | null,
		droppableContainers: new Map([
			['OPEN', { disabled: false }],
			['IN_PROGRESS', { disabled: false }],
			['COMPLETED', { disabled: false }]
		]),
		droppableRects: new Map([
			['OPEN', rectangle(0)],
			['IN_PROGRESS', rectangle(340)],
			['COMPLETED', rectangle(680)]
		])
	}
	return { active: 'task', currentCoordinates: { x: 20, y: 80 }, context }
}
const move = (code: string, value = input()) => {
	const event = new KeyboardEvent('keydown', { code, cancelable: true })
	return {
		coordinates: workdayKeyboardCoordinates(
			event,
			value as unknown as CoordinatesInput
		),
		prevented: event.defaultPrevented
	}
}
afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('workday keyboard coordinate adapter', () => {
	it.each(['ArrowRight', 'ArrowDown'])(
		'moves %s to the next column using the lifted status before over is set',
		key => {
			expect(move(key)).toEqual({
				coordinates: { x: 360, y: 20 },
				prevented: true
			})
		}
	)
	it.each(['ArrowLeft', 'ArrowUp'])(
		'moves %s back from the current over column, not the initial status',
		key => {
			const value = input()
			value.context.over = { id: 'IN_PROGRESS' }
			value.context.collisionRect = rectangle(360, 20, 260, 160)
			value.currentCoordinates = { x: 360, y: 20 }
			expect(move(key, value).coordinates).toEqual({ x: 20, y: 20 })
		}
	)
	it.each([
		'disabled',
		'missing container',
		'missing rectangle',
		'zero rectangle'
	])(
		'skips an intermediate %s and reaches the nearest available column',
		reason => {
			const value = input()
			if (reason === 'disabled')
				value.context.droppableContainers.set('IN_PROGRESS', {
					disabled: true
				})
			if (reason === 'missing container')
				value.context.droppableContainers.delete('IN_PROGRESS')
			if (reason === 'missing rectangle')
				value.context.droppableRects.delete('IN_PROGRESS')
			if (reason === 'zero rectangle')
				value.context.droppableRects.set(
					'IN_PROGRESS',
					rectangle(340, 0, 0, 0)
				)
			expect(move('ArrowRight', value).coordinates).toEqual({
				x: 700,
				y: 20
			})
		}
	)
	it('skips unavailable columns in reverse without wrapping across the board edges', () => {
		const value = input('COMPLETED')
		value.context.droppableContainers.set('IN_PROGRESS', {
			disabled: true
		})
		expect(move('ArrowLeft', value).coordinates).toEqual({ x: 20, y: 20 })
		expect(move('ArrowRight', value).coordinates).toBeUndefined()
		expect(move('ArrowLeft').coordinates).toBeUndefined()
	})
	it('does not target any column when all candidates in that direction are unavailable', () => {
		const value = input()
		value.context.droppableContainers.set('IN_PROGRESS', {
			disabled: true
		})
		value.context.droppableContainers.set('COMPLETED', { disabled: true })
		expect(move('ArrowRight', value).coordinates).toBeUndefined()
	})
	it('does not hijack non-navigation keys, unknown task statuses, or missing measurements', () => {
		for (const key of ['Space', 'Escape', 'Enter', 'KeyA'])
			expect(move(key)).toEqual({
				coordinates: undefined,
				prevented: false
			})
		expect(
			move('ArrowRight', input('CANCELLED')).coordinates
		).toBeUndefined()
		const value = input()
		value.context.collisionRect = null
		expect(move('ArrowRight', value)).toEqual({
			coordinates: undefined,
			prevented: false
		})
	})
	it('uses the center of a short target column rather than placing the task below it', () => {
		const value = input()
		value.context.droppableRects.set(
			'IN_PROGRESS',
			rectangle(340, 600, 300, 80)
		)
		expect(move('ArrowDown', value).coordinates).toEqual({
			x: 360,
			y: 560
		})
	})
})

describe('workday reduced-motion preference', () => {
	it('subscribes to system preference changes and removes its listener on unmount', () => {
		let matches = false
		const listeners = new Set<() => void>()
		const addEventListener = vi.fn(
			(_event: string, listener: () => void) => {
				listeners.add(listener)
			}
		)
		const removeEventListener = vi.fn(
			(_event: string, listener: () => void) => {
				listeners.delete(listener)
			}
		)
		const media = {
			get matches() {
				return matches
			},
			addEventListener,
			removeEventListener
		}
		const matchMedia = vi.fn(() => media)
		vi.stubGlobal('matchMedia', matchMedia)
		const rendered = renderHook(useWorkdayReducedMotion)
		expect(rendered.result.current).toBe(false)
		expect(matchMedia).toHaveBeenCalledWith(
			'(prefers-reduced-motion: reduce)'
		)
		act(() => {
			matches = true
			listeners.forEach(listener => listener())
		})
		expect(rendered.result.current).toBe(true)
		act(() => {
			matches = false
			listeners.forEach(listener => listener())
		})
		expect(rendered.result.current).toBe(false)
		rendered.unmount()
		expect(removeEventListener).toHaveBeenCalledWith(
			'change',
			addEventListener.mock.calls[0][1]
		)
		expect(listeners.size).toBe(0)
	})
	it('supports environments without matchMedia and disables motion in the server snapshot', () => {
		vi.stubGlobal('matchMedia', undefined)
		const rendered = renderHook(useWorkdayReducedMotion)
		expect(rendered.result.current).toBe(false)
		const Probe = () =>
			useWorkdayReducedMotion() ? 'reduced' : 'animated'
		expect(renderToString(createElement(Probe))).toBe('reduced')
	})
})
