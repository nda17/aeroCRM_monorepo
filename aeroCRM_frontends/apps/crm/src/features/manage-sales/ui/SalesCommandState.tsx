'use client'

import { Button } from '@/shared/ui'
import type { useSalesCommand } from '../model/use-sales-command'
import toast from 'react-hot-toast'
import styles from './SalesWorkflow.module.scss'

export const SalesCommandState = ({
	command,
	onReview
}: {
	command: ReturnType<typeof useSalesCommand>
	onReview: () => Promise<void>
}) =>
	command.error ? (
		<div role="alert" className={styles.error}>
			<p>{command.error.message}</p>
			{command.ambiguous ? (
				<>
					<p>
						Ответ не подтверждён. Поля временно заблокированы, повтор
						отправит тот же запрос.
					</p>
					<Button
						variant="secondary"
						tooltip="Повторить прежний запрос с теми же данными, чтобы подтвердить результат сохранения."
						disabled={!command.canRetry}
						isLoading={command.pending}
						onClick={() => void command.execute()}
					>
						Проверить сохранение
					</Button>
				</>
			) : command.blocked ? (
				<Button
					variant="secondary"
					tooltip="Загрузить актуальное состояние сделки перед новым изменением."
					onClick={() => {
						void onReview().catch(() =>
							toast.error('Не удалось обновить данные')
						)
					}}
				>
					Обновить данные и проверить
				</Button>
			) : null}
		</div>
	) : null
