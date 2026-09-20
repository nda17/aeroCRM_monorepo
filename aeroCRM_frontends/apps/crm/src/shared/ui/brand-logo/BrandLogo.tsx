import brand from '../../../../../../brand/aerocrm-wing.json'
import clsx from 'clsx'
import Link from 'next/link'
import styles from './BrandLogo.module.scss'

export interface BrandLogoProps {
	href?: string
	className?: string
	size?: 'default' | 'compact'
}

export const BrandLogo = ({ href, className }: BrandLogoProps) => {
	const logo = (
		<svg className={styles.wordmark} viewBox={brand.viewBox} role="img" aria-label="aeroCRM">
			<path d={brand.wing} fill="#efc85b" />
			<path d={brand.wordmark} fill="currentColor" />
		</svg>
	)
	return href ? <Link href={href} className={clsx(styles.logo, className)} aria-label="aeroCRM">{logo}</Link> : <span className={clsx(styles.logo, className)}>{logo}</span>
}
