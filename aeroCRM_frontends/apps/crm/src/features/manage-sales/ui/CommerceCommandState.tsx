'use client'

import { Button } from '@/shared/ui'
import type { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import toast from 'react-hot-toast'
import styles from './Commerce.module.scss'

export const CommerceCommandState = ({
	command,
	onReview
}: {
	command: {
		error: AuthenticatedApiError | null
		uncertain: boolean
		running: boolean
		blocked: boolean
		enabled: boolean
		execute: () => Promise<void>
		reset: () => boolean
	}
	onReview: () => Promise<unknown>
}) =>
	command.error ? (
		<div className={styles.error} role="alert">
			<p>{command.error.message}</p>
			{command.uncertain ? (
				<>
					<p>
						Результат ещё не подтверждён. Повтор отправит ту же команду с
						теми же данными.
					</p>
					<Button
						variant="secondary"
						disabled={!command.enabled || command.running}
						isLoading={command.running}
						onClick={() => void command.execute()}
					>
						Проверить сохранение
					</Button>
				</>
			) : command.blocked ? (
				<Button
					variant="secondary"
					onClick={() =>
						void onReview()
							.then(() => command.reset())
							.catch(() => toast.error('Не удалось обновить данные'))
					}
				>
					Обновить данные и проверить
				</Button>
			) : null}
		</div>
	) : null
