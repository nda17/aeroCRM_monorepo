'use client'

import { Button } from '@/shared/ui'
import toast from 'react-hot-toast'
import { tildaSourceWebhookUrl } from '../model/source-credential'
import styles from './IntakeForms.module.scss'

export const TildaSourceSetup = ({ sourceId }: { sourceId: string }) => {
	const address = tildaSourceWebhookUrl(sourceId)
	const copyAddress = async () => {
		try {
			await navigator.clipboard.writeText(address)
			toast.success('Адрес Webhook для Tilda скопирован')
		} catch {
			toast.error(
				'Не удалось скопировать адрес. Разрешите доступ к буферу обмена или скопируйте вручную.'
			)
		}
	}
	return (
		<div className={styles.form}>
			<p>Адрес Webhook для Tilda:</p>
			<code className={styles.secret} aria-label="Адрес Webhook для Tilda">
				{address}
			</code>
			<Button variant="secondary" onClick={() => void copyAddress()}>
				Скопировать адрес Tilda
			</Button>
			<ol className={styles.setupSteps}>
				<li>
					В Tilda откройте{' '}
					<strong>Настройки сайта → Формы → Webhook</strong> и вставьте
					этот адрес.
				</li>
				<li>
					Укажите имя API-ключа <code>X-aeroCRM-Source-Token</code>, а в
					значении — секретный ключ источника без <code>Bearer</code>.
					Выберите передачу ключа <strong>в заголовке</strong>, не в теле
					POST-запроса.
				</li>
				<li>
					Сохраните подключение. Проверочный запрос Tilda проверяет доступ,
					но не создаёт обращение в aeroCRM.
				</li>
				<li>
					Отметьте этот приёмщик данных в нужных формах Tilda и
					перепубликуйте страницы с этими формами.
				</li>
				<li>
					Отправьте форму с опубликованной страницы и найдите обращение во
					«Входящих» aeroCRM. Сохранение адреса и проверка подключения не
					подтверждают доставку реальной заявки.
				</li>
			</ol>
			<p className={styles.notice}>
				Для основных данных используйте имена переменных полей{' '}
				<code>Name</code>, <code>Email</code>, <code>Phone</code> и{' '}
				<code>Comments</code> — регистр не важен. Без имени клиента будет
				использовано «Заявка с Tilda». Дополнительные поля попадут в
				комментарий. Идентификатор отправки добавляет Tilda; повтор одной
				отправки не создаёт новое обращение.
			</p>
			<p className={styles.notice}>
				Передачу Cookies включать не нужно. Не добавляйте ключ в URL, поля
				формы или браузерный код. aeroCRM не показывает сохранённый ключ
				повторно: если он потерян, замените ключ источника и обновите его в
				настройках Tilda.
			</p>
		</div>
	)
}
