'use client'
import { workspaceAuthApi } from '@/features/workspace-auth/api/workspace-auth.api'
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
	const needsResetRef = useRef(false)
	const executingRef = useRef(false)
	const waiterRef = useRef<TokenWaiter | null>(null)
	const generationRef = useRef(0)
	const lifecycleRef = useRef(0)
	const [size, setSize] = useState<'flexible' | 'compact'>('flexible')
	const [isReady, setIsReady] = useState(false)
	const [isUnavailable, setIsUnavailable] = useState(false)
	const [retry, setRetry] = useState(0)
	const { data: authSettings } = useQuery({
		queryKey: ['auth-settings'],
		queryFn: workspaceAuthApi.getSettings,
		enabled: isProductionMode
	})
	const isTurnstileEnabled =
		isProductionMode && (authSettings?.turnstileEnabled ?? true)

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
		needsResetRef.current = false
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
						tokenRef.current = null
						needsResetRef.current = false
						setIsUnavailable(true)
						setIsReady(false)
						waiterRef.current?.reject(new TurnstileUnavailableError())
						return
					}
					if (waiterRef.current) {
						tokenRef.current = null
						needsResetRef.current = true
						waiterRef.current.resolve(token)
					} else {
						tokenRef.current = token
						needsResetRef.current = false
					}
					setIsReady(true)
					setIsUnavailable(false)
				},
				'error-callback': () => {
					if (generation !== generationRef.current) return
					tokenRef.current = null
					needsResetRef.current = false
					setIsUnavailable(true)
					setIsReady(false)
					waiterRef.current?.reject(new TurnstileUnavailableError())
				},
				'expired-callback': () => {
					if (generation !== generationRef.current) return
					tokenRef.current = null
					needsResetRef.current = false
				}
			})
			setIsReady(true)
		},
		[container, removeWidget, siteKey, size]
	)

	useEffect(() => {
		if (!isTurnstileEnabled || !container) return
		let cancelled = false
		const lifecycle = ++lifecycleRef.current
		void loadTurnstileScript()
			.then(() => {
				if (!cancelled && lifecycle === lifecycleRef.current)
					renderWidget(action)
			})
			.catch(() => {
				if (!cancelled && lifecycle === lifecycleRef.current)
					setIsUnavailable(true)
			})
		return () => {
			cancelled = true
			lifecycleRef.current += 1
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
		if (executingRef.current) throw new TurnstileUnavailableError()
		executingRef.current = true
		const lifecycle = lifecycleRef.current
		let generation = generationRef.current
		try {
			if (!siteKey) throw new TurnstileUnavailableError()
			await loadTurnstileScript()
			if (lifecycle !== lifecycleRef.current)
				throw new TurnstileUnavailableError()
			if (widgetActionRef.current !== requestedAction)
				renderWidget(requestedAction)
			generation = generationRef.current
			let token = tokenRef.current
			if (token) {
				tokenRef.current = null
				needsResetRef.current = true
			} else {
				token = await new Promise<string>((resolve, reject) => {
					const timeout = window.setTimeout(() => {
						if (waiterRef.current === waiter)
							waiter.reject(new TurnstileUnavailableError())
					}, 120000)
					const finish = () => {
						window.clearTimeout(timeout)
						if (waiterRef.current === waiter) waiterRef.current = null
					}
					const waiter: TokenWaiter = {
						resolve: value => {
							finish()
							resolve(value)
						},
						reject: error => {
							finish()
							reject(error)
						}
					}
					waiterRef.current = waiter
					if (needsResetRef.current) {
						const widgetId = widgetIdRef.current
						if (!widgetId || !window.turnstile) {
							waiter.reject(new TurnstileUnavailableError())
							return
						}
						needsResetRef.current = false
						try {
							window.turnstile.reset(widgetId)
						} catch {
							waiter.reject(new TurnstileUnavailableError())
						}
					}
				})
			}
			if (
				lifecycle !== lifecycleRef.current ||
				generation !== generationRef.current
			)
				throw new TurnstileUnavailableError()
			setIsUnavailable(false)
			setIsReady(true)
			return token
		} catch (error) {
			if (
				lifecycle === lifecycleRef.current &&
				generation === generationRef.current
			) {
				setIsUnavailable(true)
				setIsReady(false)
			}
			throw error
		} finally {
			executingRef.current = false
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
