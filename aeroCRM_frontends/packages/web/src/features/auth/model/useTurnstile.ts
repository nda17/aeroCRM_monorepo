'use client'
import { authSettingsService } from '@/features/auth/api/auth.api'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
	executeTurnstileToken,
	loadTurnstileScript,
	TurnstileUnavailableError,
	waitForTurnstileReady
} from './turnstile-client'

export const useTurnstile = () => {
	const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
	const isProductionMode = process.env.NEXT_PUBLIC_MODE === 'production'
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

	useEffect(() => {
		if (!isTurnstileEnabled) return
		let ignore = false
		setIsReady(false)
		setIsUnavailable(false)
		const initialize = async () => {
			if (!siteKey) throw new TurnstileUnavailableError()
			await loadTurnstileScript(siteKey)
			await waitForTurnstileReady()
		}
		void initialize()
			.then(() => {
				if (!ignore) setIsReady(true)
			})
			.catch(() => {
				if (!ignore) setIsUnavailable(true)
			})
		return () => {
			ignore = true
		}
	}, [siteKey, isTurnstileEnabled, retry])

	const executeTurnstile = async (action: string) => {
		if (!isTurnstileEnabled) return null
		try {
			if (!siteKey) throw new TurnstileUnavailableError()
			await loadTurnstileScript(siteKey)
			await waitForTurnstileReady()
			const token = await executeTurnstileToken(siteKey, action)
			setIsUnavailable(false)
			setIsReady(true)
			return token
		} catch (error) {
			setIsUnavailable(true)
			setIsReady(false)
			throw error
		}
	}

	return {
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
