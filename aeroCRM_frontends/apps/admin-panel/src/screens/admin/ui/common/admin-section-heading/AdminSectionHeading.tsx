'use client'

import AdminTooltip, {
	type AdminTooltipProps
} from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import styles from './AdminSectionHeading.module.scss'

interface AdminSectionHeadingProps extends AdminTooltipProps {
	text: string
}

const AdminSectionHeading = ({
	text,
	...tooltip
}: AdminSectionHeadingProps) => (
	<div className={styles.heading}>
		<h2 className={styles.title}>{text}</h2>
		<AdminTooltip {...tooltip} />
	</div>
)

export default AdminSectionHeading
