import { Button } from '@/shared/ui'

export const MailCommandNotice = ({
	command
}: {
	command: {
		running: boolean
		uncertain: boolean
		error: Error | null
		recover: () => Promise<void>
		enabled?: boolean
		checkingAccess?: boolean
		recheckAccess?: () => Promise<unknown>
	}
}) => {
	if (command.running)
		return <p role="status">Проверяем результат операции…</p>
	if (command.enabled === false)
		return (
			<div role="status">
				<p>
					{command.checkingAccess
						? 'Проверяем доступ к почте…'
						: 'Действие недоступно. Проверьте подключение и права на почту.'}
				</p>
				{command.recheckAccess ? (
					<Button
						variant="secondary"
						disabled={command.checkingAccess}
						onClick={() => void command.recheckAccess?.()}
					>
						Проверить доступ
					</Button>
				) : null}
			</div>
		)
	if (command.uncertain)
		return (
			<div role="status">
				<p>
					Результат операции пока не подтверждён. Проверка использует
					исходную команду.
				</p>
				<Button variant="secondary" onClick={() => void command.recover()}>
					Проверить результат
				</Button>
			</div>
		)
	return command.error ? <p role="alert">{command.error.message}</p> : null
}
