import brand from '../../../../../../brand/aerocrm-wing.json'
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
			<path d={brand.wing} fill="#efc85b" />
			<path d={brand.wordmark} fill="currentColor" />
		</svg>
	</Link>
)

export default LogoImage
