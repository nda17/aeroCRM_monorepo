import { Button } from '@/shared/ui'
import type { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'

export function CommandNotice({
	command
}: {
	command: {
		error: AuthenticatedApiError | null
		uncertain: boolean
		running: boolean
		execute: () => Promise<void>
		reset: () => void
	}
}) {
	if (!command.error && !command.uncertain) return null
	return (
		<div role="alert">
			<p>
				{command.uncertain
					? 'Результат ещё не подтверждён. Повторите сохранённый запрос — дубликат не появится.'
					: command.error?.message}
			</p>
			{command.uncertain ? (
				<Button
					variant="secondary"
					disabled={command.running}
					onClick={() => void command.execute()}
				>
					Проверить результат
				</Button>
			) : null}
		</div>
	)
}
