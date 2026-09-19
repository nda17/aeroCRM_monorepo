import AppIcon from '@/shared/ui/icons/AppIcon'
import styles from '@/shared/ui/search-field/SearchField.module.scss'
import { ISearchField } from '@/shared/ui/search-field/search-field.interface'
import { NextPage } from 'next'

export const SearchField: NextPage<ISearchField> = ({
	searchTerm,
	handleSearch,
	handleClear,
	placeholder = 'Поиск...'
}) => {
	return (
		<div className={styles.searchField}>
			<AppIcon name="search" />
			<input
				placeholder={placeholder}
				value={searchTerm}
				onChange={handleSearch}
			/>
			{!searchTerm ? null : (
				<button
					type="button"
					onClick={handleClear}
					aria-label="Очистить поиск"
				>
					<AppIcon name="close" />
				</button>
			)}
		</div>
	)
}
