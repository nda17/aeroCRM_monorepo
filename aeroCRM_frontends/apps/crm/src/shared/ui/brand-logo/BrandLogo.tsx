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
		<svg className={styles.wordmark} viewBox="0 0 278 66" role="img" aria-label="aeroCRM">
			<path d="M8 52C37 58 68 55 95 44" fill="none" stroke="#a653c4" strokeWidth="5" strokeLinecap="round" />
			<path d="M9 60C44 64 76 56 101 39" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".6" />
			<text x="12" y="44" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="42" fontWeight="900" fontStyle="italic" letterSpacing="-3">aero</text>
			<text x="107" y="44" fill="#a653c4" fontFamily="Arial, sans-serif" fontSize="42" fontWeight="900" fontStyle="italic" letterSpacing="-3">CRM</text>
		</svg>
	)
	return href ? <Link href={href} className={clsx(styles.logo, className)} aria-label="aeroCRM">{logo}</Link> : <span className={clsx(styles.logo, className)}>{logo}</span>
}
