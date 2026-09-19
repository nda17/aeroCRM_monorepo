import { Button } from '@/shared/ui'
import type { useWorkdayCommand } from '../model/use-workday-command'
import styles from './WorkdayTaskDrawer.module.scss'

export const WorkdayCommandState = ({
	command
}: {
	command: ReturnType<typeof useWorkdayCommand>
}) => (
	<>
		{command.error ? (
			<p role="alert" className={styles.error}>
				{command.error.message}
			</p>
		) : null}
		{command.ambiguous ? (
			<div className={styles.warning}>
				<p>
					Результат сохранения пока неизвестен. Повторная проверка отправит
					исходную команду, не создавая новое изменение.
				</p>
				<Button
					variant="secondary"
					disabled={!command.canRetry}
					onClick={() => void command.execute()}
				>
					Проверить результат
				</Button>
			</div>
		) : null}
		{command.pending ? (
			<p role="status" className={styles.note}>
				Сохраняем задачу…
			</p>
		) : null}
	</>
)
