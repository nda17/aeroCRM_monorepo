import styles from '@/shared/ui/logo-image/LogoImage.module.scss'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import clsx from 'clsx'
import Link from '@/shared/lib/navigation/ZoneLink'

interface LogoImageProps {
	isLight?: boolean
}

const LogoImage = ({ isLight }: LogoImageProps) => (
	<Link
		href={PUBLIC_PAGES.HOME}
		className={clsx(styles.logo, isLight && styles.logoLight)}
		aria-label="aeroCRM — перейти на главную"
	>
		<svg className={styles.logoSvg} viewBox="0 0 278 66" role="img" aria-label="aeroCRM">
			<path d="M8 52C37 58 68 55 95 44" fill="none" stroke="var(--logo-secondary)" strokeWidth="5" strokeLinecap="round" />
			<path d="M9 60C44 64 76 56 101 39" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".6" />
			<text x="12" y="44" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="42" fontWeight="900" fontStyle="italic" letterSpacing="-3">aero</text>
			<text x="107" y="44" fill="var(--logo-secondary)" fontFamily="Arial, sans-serif" fontSize="42" fontWeight="900" fontStyle="italic" letterSpacing="-3">CRM</text>
		</svg>
	</Link>
)

export default LogoImage
