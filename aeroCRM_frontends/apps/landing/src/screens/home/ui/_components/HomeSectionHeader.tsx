import styles from './HomeSectionHeader.module.scss'

interface HomeSectionHeaderProps {
	title: string
	subtitle: string
	className?: string
	align?: 'center' | 'left'
}

const HomeSectionHeader = ({
	title,
	subtitle,
	className = '',
	align = 'center'
}: HomeSectionHeaderProps) => (
	<div
		className={`${styles.heading} ${align === 'left' ? styles.headingLeft : ''} ${className}`}
	>
		<h2 className={styles.title}>{title}</h2>
		{subtitle && <p className={styles.subtitle}>{subtitle}</p>}
	</div>
)

export default HomeSectionHeader
