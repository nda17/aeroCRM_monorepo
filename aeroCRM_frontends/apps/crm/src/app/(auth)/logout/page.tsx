'use client'

import { useSessionStore } from '@/entities/session'
import { workspaceAuthApi } from '@/features/workspace-auth/api/workspace-auth.api'
import { parseWorkspaceReturnPath } from '@/shared/lib/auth-return-url'
import { Button, ScreenState } from '@/shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

const LogoutPage = () => {
	const queryClient = useQueryClient()
	const started = useRef(false)
	const [error, setError] = useState('')
	const logout = useCallback(async () => {
		setError('')
		try {
			await workspaceAuthApi.logout()
			queryClient.clear()
			useSessionStore.getState().setAnonymous()
			const requested = new URLSearchParams(window.location.search).get(
				'returnPath'
			)
			const safe = requested && parseWorkspaceReturnPath(requested)
			window.location.replace(
				safe
					? `/login?${new URLSearchParams({ returnPath: safe })}`
					: '/login'
			)
		} catch {
			setError('Не удалось подтвердить выход. Повторите попытку.')
		}
	}, [queryClient])

	useEffect(() => {
		if (started.current) return
		started.current = true
		void logout()
	}, [logout])

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
			{error ? (
				<>
					<h1 className="text-2xl font-semibold">Выход из аккаунта</h1>
					<p role="alert">{error}</p>
					<Button onClick={() => void logout()}>Повторить</Button>
				</>
			) : (
				<ScreenState variant="loading" title="Завершаем сессию" />
			)}
		</main>
	)
}

export default LogoutPage
