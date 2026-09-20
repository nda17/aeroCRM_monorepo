'use client'
import { authSettingsService } from '@/features/auth/api/auth.api'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	loadTurnstileScript,
	TurnstileUnavailableError
} from './turnstile-client'

type TokenWaiter = {
	resolve: (token: string) => void
	reject: (error: Error) => void
}

export const useTurnstile = (action: string) => {
	const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
	const isProductionMode = process.env.NEXT_PUBLIC_MODE === 'production'
	const [container, setContainer] = useState<HTMLDivElement | null>(null)
	const widgetIdRef = useRef<string | null>(null)
	const widgetActionRef = useRef<string | null>(null)
	const tokenRef = useRef<string | null>(null)
	const waiterRef = useRef<TokenWaiter | null>(null)
	const generationRef = useRef(0)
	const actionRef = useRef(action)
	const [size, setSize] = useState<'flexible' | 'compact'>('flexible')
	const [isReady, setIsReady] = useState(false)
	const [isUnavailable, setIsUnavailable] = useState(false)
	const [retry, setRetry] = useState(0)
	const { data: authSettings } = useQuery({
		queryKey: ['auth-settings'],
		queryFn: authSettingsService.get,
		enabled: isProductionMode
	})
	const isTurnstileEnabled =
		isProductionMode && (authSettings?.turnstileEnabled ?? true)
	actionRef.current = action

	useEffect(() => {
		if (!container || !isTurnstileEnabled) return
		const observer = new ResizeObserver(entries => {
			setSize(entries[0].contentRect.width < 300 ? 'compact' : 'flexible')
		})
		observer.observe(container)
		return () => observer.disconnect()
	}, [container, isTurnstileEnabled])

	const removeWidget = useCallback(() => {
		generationRef.current += 1
		if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current)
		widgetIdRef.current = null
		widgetActionRef.current = null
		tokenRef.current = null
		waiterRef.current?.reject(new TurnstileUnavailableError())
		waiterRef.current = null
	}, [])

	const renderWidget = useCallback(
		(widgetAction: string) => {
			const turnstile = window.turnstile
			if (!turnstile || !container || !siteKey)
				throw new TurnstileUnavailableError()
			removeWidget()
			const generation = generationRef.current
			container.dataset.turnstileSize = size
			widgetActionRef.current = widgetAction
			widgetIdRef.current = turnstile.render(container, {
				sitekey: siteKey,
				action: widgetAction,
				execution: 'render',
				appearance: 'always',
				theme: 'light',
				size,
				callback: token => {
					if (generation !== generationRef.current) return
					if (!token) {
						setIsUnavailable(true)
						waiterRef.current?.reject(new TurnstileUnavailableError())
						waiterRef.current = null
						return
					}
					tokenRef.current = token
					waiterRef.current?.resolve(token)
					waiterRef.current = null
				},
				'error-callback': () => {
					if (generation !== generationRef.current) return
					tokenRef.current = null
					setIsUnavailable(true)
					waiterRef.current?.reject(new TurnstileUnavailableError())
					waiterRef.current = null
				},
				'expired-callback': () => {
					if (generation !== generationRef.current) return
					tokenRef.current = null
					if (widgetIdRef.current) turnstile.reset(widgetIdRef.current)
				}
			})
			setIsReady(true)
		},
		[container, removeWidget, siteKey, size]
	)

	useEffect(() => {
		if (!isTurnstileEnabled || !container) return
		let cancelled = false
		setIsReady(false)
		setIsUnavailable(false)
		void loadTurnstileScript()
			.then(() => {
				if (!cancelled) renderWidget(action)
			})
			.catch(() => {
				if (!cancelled) setIsUnavailable(true)
			})
		return () => {
			cancelled = true
			removeWidget()
		}
	}, [
		action,
		container,
		isTurnstileEnabled,
		renderWidget,
		removeWidget,
		retry
	])

	const executeTurnstile = async (requestedAction: string) => {
		if (!isTurnstileEnabled) return null
		try {
			if (!siteKey) throw new TurnstileUnavailableError()
			await loadTurnstileScript()
			if (widgetActionRef.current !== requestedAction)
				renderWidget(requestedAction)
			const token =
				tokenRef.current ||
				(await new Promise<string>((resolve, reject) => {
					const timeout = window.setTimeout(() => {
						waiterRef.current = null
						reject(new TurnstileUnavailableError())
					}, 120000)
					waiterRef.current = {
						resolve: value => {
							window.clearTimeout(timeout)
							resolve(value)
						},
						reject: error => {
							window.clearTimeout(timeout)
							reject(error)
						}
					}
				}))
			tokenRef.current = null
			if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current)
			if (requestedAction !== actionRef.current)
				renderWidget(actionRef.current)
			setIsUnavailable(false)
			return token
		} catch (error) {
			setIsUnavailable(true)
			setIsReady(false)
			throw error
		}
	}

	return {
		containerRef: setContainer,
		executeTurnstile,
		isTurnstileEnabled,
		isTurnstileReady: !isTurnstileEnabled || isReady,
		isTurnstileUnavailable: isTurnstileEnabled && isUnavailable,
		markTurnstileUnavailable: () => setIsUnavailable(true),
		retryTurnstile: () => {
			setIsUnavailable(false)
			setRetry(value => value + 1)
		}
	}
}
