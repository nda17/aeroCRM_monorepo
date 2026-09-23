'use client'

import { useSessionBootstrap } from '@/features/session-bootstrap/model/useSessionBootstrap'
import styles from '@/features/session-bootstrap/ui/SessionGate.module.scss'
import {
	buildLoginUrl,
	captureInvitationEmailHint,
	invitationEmailFragment
} from '@/shared/lib/auth-return-url'
import { Button, ScreenState } from '@/shared/ui'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useRef } from 'react'

interface SessionGateProps extends PropsWithChildren {
	redirectToLogin?: (url: string) => void
}

const replaceLocation = (url: string) => window.location.replace(url)

const SessionGate = ({
	children,
	redirectToLogin = replaceLocation
}: SessionGateProps) => {
	const { status, errorMessage, retry, fail } = useSessionBootstrap()
	const hasStartedRedirect = useRef(false)

	useEffect(() => {
		const returnPath = `${window.location.pathname}${window.location.search}`
		captureInvitationEmailHint(returnPath)
		if (status !== 'anonymous' || hasStartedRedirect.current) {
			return
		}

		try {
			const loginUrl = buildLoginUrl(window.location.href)
			hasStartedRedirect.current = true
			redirectToLogin(loginUrl + invitationEmailFragment(returnPath))
		} catch {
			fail('Не удалось подготовить безопасный переход на страницу входа.')
		}
	}, [fail, redirectToLogin, status])

	const handleRetry = useCallback(() => {
		hasStartedRedirect.current = false
		retry()
	}, [retry])

	if (status === 'authenticated') {
		return <>{children}</>
	}

	if (status === 'error') {
		return (
			<div className={styles.viewport}>
				<ScreenState
					className={styles.state}
					variant="error"
					title="Не удалось проверить сессию"
					description={
						errorMessage || 'Повторите попытку через несколько секунд.'
					}
					action={<Button onClick={handleRetry}>Повторить</Button>}
				/>
			</div>
		)
	}

	return (
		<div className={styles.viewport}>
			<ScreenState
				className={styles.state}
				variant="loading"
				title={
					status === 'anonymous'
						? 'Переходим к авторизации'
						: 'Проверяем сессию'
				}
				description="Рабочее пространство откроется после безопасной проверки входа."
			/>
		</div>
	)
}

export default SessionGate
