import type { InboxSlaItem } from '@/entities/intake-sla'
import { StatusBadge } from '@/shared/ui'

export const SlaInboxBadge = ({
	item,
	loading,
	deliveryEnabled,
	unavailable,
	notActivated = false
}: {
	item?: InboxSlaItem
	loading: boolean
	deliveryEnabled?: boolean
	unavailable: boolean
	notActivated?: boolean
}) => {
	if (loading)
		return <StatusBadge tone="neutral">Проверяем SLA…</StatusBadge>
	if (notActivated)
		return <StatusBadge tone="neutral">SLA не активирован</StatusBadge>
	if (unavailable || deliveryEnabled === undefined || !item)
		return <StatusBadge tone="neutral">SLA недоступен</StatusBadge>
	if (!deliveryEnabled)
		return (
			<StatusBadge
				tone="neutral"
				title="Доставка SLA-напоминаний ещё не активирована"
			>
				SLA не активирован
			</StatusBadge>
		)
	if (item.state === 'NOT_TRACKED')
		return <StatusBadge tone="neutral">Без SLA</StatusBadge>
	if (item.state === 'STOPPED')
		return <StatusBadge tone="neutral">SLA остановлен</StatusBadge>
	const due = item.dueAt
		? new Date(item.dueAt).toLocaleString('ru-RU')
		: ''
	return (
		<StatusBadge
			tone={item.state === 'BREACHED' ? 'danger' : 'warning'}
			title={`Срок принятия в работу: ${due}`}
		>
			{item.state === 'BREACHED' ? 'SLA просрочен' : `SLA до ${due}`}
		</StatusBadge>
	)
}
