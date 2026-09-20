import styles from '@/features/auth/ui/auth-form/social-media-buttons/SocialMediaButtons.module.scss'
import { API_URL } from '@/shared/config/api.config'
import AppIcon from '@/shared/ui/icons/AppIcon'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { authSettingsService } from '@/features/auth/api/auth.api'
import {
	clearAuthReturnIntent,
	saveAuthReturnIntent
} from '@/shared/lib/auth-return-url'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'

const AFFILIATE_REFERRER_STORAGE_KEY = 'affiliateReferrerId'
const SOCIAL_AUTH_SKELETON_ITEMS = [0, 1]

interface SocialMediaButtonsProps {
	authReturnUrl?: string | null
}

const SocialMediaButtons = ({
	authReturnUrl
}: SocialMediaButtonsProps) => {
	const { data: authSettings, isPending: isAuthSettingsPending } =
		useQuery({
			queryKey: ['auth-settings'],
			queryFn: authSettingsService.get
		})
	const googleAuthEnabled = Boolean(authSettings?.googleAuthEnabled)
	const yandexAuthEnabled = Boolean(authSettings?.yandexAuthEnabled)
	const vkAuthEnabled = Boolean(authSettings?.vkAuthEnabled)
	const hasSocialAuthButtons =
		googleAuthEnabled || yandexAuthEnabled || vkAuthEnabled

	const handleSocialAuth = (path: string) => {
		if (authReturnUrl) {
			saveAuthReturnIntent(window.sessionStorage, authReturnUrl)
		} else {
			clearAuthReturnIntent(window.sessionStorage)
		}

		const referrerId =
			typeof window !== 'undefined'
				? window.localStorage
						.getItem(AFFILIATE_REFERRER_STORAGE_KEY)
						?.trim()
				: ''
		const targetPath = referrerId
			? `${path}?${new URLSearchParams({ ref: referrerId })}`
			: path

		toast.loading('Пожалуйста, подождите', { id: 'social-auth' })
		window.location.assign(targetPath)
	}

	if (isAuthSettingsPending) {
		return (
			<>
				<div className={styles.sectionDivider}>
					<span>или продолжить через</span>
				</div>
				<div
					className={styles.wrapper}
					aria-busy="true"
					aria-label="Загрузка способов входа"
				>
					{SOCIAL_AUTH_SKELETON_ITEMS.map(item => (
						<SkeletonLoader
							key={item}
							containerClassName={styles.skeletonButtonWrapper}
							className={styles.skeletonButton}
						/>
					))}
				</div>
			</>
		)
	}

	if (!hasSocialAuthButtons) return null

	return (
		<>
			<div className={styles.sectionDivider}>
				<span>или продолжить через</span>
			</div>
			<div className={styles.wrapper}>
				{googleAuthEnabled && (
					<button
						onClick={() => handleSocialAuth(`${API_URL}/auth/google`)}
						className={styles.button}
						type="button"
					>
						<AppIcon name="google" fill="currentColor" />
						<span>Google</span>
					</button>
				)}
				{yandexAuthEnabled && (
					<button
						onClick={() => handleSocialAuth(`${API_URL}/auth/yandex`)}
						className={styles.button}
						type="button"
					>
						<AppIcon name="yandex" fill="currentColor" />
						<span>Яндекс</span>
					</button>
				)}
				{vkAuthEnabled && (
					<button
						onClick={() => handleSocialAuth(`${API_URL}/auth/vk`)}
						className={styles.button}
						type="button"
					>
						<AppIcon name="vk" fill="currentColor" />
						<span>VK</span>
					</button>
				)}
			</div>
		</>
	)
}

export default SocialMediaButtons
