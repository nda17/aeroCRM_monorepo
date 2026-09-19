import styles from '@/screens/admin/ui/common/admin-header/AdminHeader.module.scss'
import { IAdminHeader } from '@/screens/admin/ui/common/admin-header/admin-header.interface'
import { SearchField } from '@/shared/ui/search-field/SearchField'
import { NextPage } from 'next'

const AdminHeader: NextPage<IAdminHeader> = ({
	handleSearch,
	searchTerm,
	handleClear
}) => {
	return (
		<div className={styles.header}>
			<SearchField
				searchTerm={searchTerm}
				handleSearch={handleSearch}
				handleClear={handleClear}
			/>
		</div>
	)
}

export default AdminHeader
