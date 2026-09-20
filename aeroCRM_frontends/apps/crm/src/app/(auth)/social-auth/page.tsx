'use client'

import { useSessionStore } from '@/entities/session'
import {
	refreshSession,
	SessionBootstrapError
} from '@/features/session-bootstrap/api/refresh-session'
import { parseWorkspaceReturnPath } from '@/shared/lib/auth-return-url'
import { Button, ScreenState } from '@/shared/ui'
import { useEffect, useRef, useState } from 'react'

const SocialAuthPage = () => {
	const started = useRef(false)
	const [error, setError] = useState('')
	const complete = async () => {
		const returnPath =
			parseWorkspaceReturnPath(
				new URLSearchParams(window.location.search).get('returnPath')
			) ?? '/inbox'
		setError('')
		try {
			const session = await refreshSession()
			useSessionStore.getState().setAuthenticated(session)
			window.location.replace(returnPath)
		} catch (failure) {
			if (
				failure instanceof SessionBootstrapError &&
				failure.kind === 'anonymous'
			) {
				useSessionStore.getState().setAnonymous()
				window.location.replace(
					`/login?${new URLSearchParams({ returnPath })}`
				)
				return
			}
			setError(
				'Не удалось проверить вход. Проверьте подключение и повторите попытку.'
			)
		}
	}

	useEffect(() => {
		if (started.current) return
		started.current = true
		void complete()
	}, [])

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
			{error ? (
				<>
					<h1 className="text-2xl font-semibold">Проверяем вход</h1>
					<p role="alert">{error}</p>
					<Button onClick={() => void complete()}>Повторить</Button>
				</>
			) : (
				<ScreenState
					variant="loading"
					title="Проверяем вход"
					description="Рабочее пространство откроется после проверки сессии."
				/>
			)}
		</main>
	)
}

export default SocialAuthPage
