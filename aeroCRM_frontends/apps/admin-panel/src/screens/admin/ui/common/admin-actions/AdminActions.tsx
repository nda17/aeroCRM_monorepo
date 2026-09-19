import styles from '@/screens/admin/ui/common/admin-actions/AdminActions.module.scss'
import { IAdminActions } from '@/screens/admin/ui/common/admin-actions/admin-actions.interface'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { NextPage } from 'next'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'

const AdminActions: NextPage<IAdminActions> = ({
	editUrl,
	userId,
	onDelete,
	onRestore,
	disabled = false
}) => {
	const { push } = useRouter()

	if (onRestore) {
		return (
			<div className={styles.wrapper}>
				<button
					type="button"
					className={`${styles.item} ${styles.restoreItem}`}
					onClick={() => onRestore(userId)}
					disabled={disabled}
					aria-label="Восстановить пользователя"
					title="Восстановить пользователя"
				>
					<AppIcon name="refresh" />
				</button>
			</div>
		)
	}

	return (
		<div className={styles.wrapper}>
			<button
				type="button"
				className={styles.item}
				onClick={() => push(editUrl)}
				disabled={disabled}
				aria-label="Редактировать пользователя"
				title="Редактировать пользователя"
			>
				<AppIcon name="edit" />
			</button>
			<button
				type="button"
				className={styles.item}
				onClick={() => {
					onDelete?.(userId)
				}}
				disabled={disabled}
				aria-label="Удалить пользователя"
				title="Удалить пользователя"
			>
				<AppIcon name="close" />
			</button>
		</div>
	)
}

export default AdminActions
