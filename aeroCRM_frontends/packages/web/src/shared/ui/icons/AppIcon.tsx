import type { AppIconName } from '@/shared/types/icon.types'
import {
	AppsIcon,
	ClockIcon,
	CloseIcon,
	CookieIcon,
	DiamondIcon,
	EditIcon,
	EllipsisIcon,
	EyeIcon,
	EyeOffIcon,
	HelpCircleIcon,
	HomeIcon,
	LockIcon,
	LoginIcon,
	LogoutIcon,
	MenuIcon,
	NavigateBeforeIcon,
	NavigateNextIcon,
	PaymentIcon,
	PersonAddIcon,
	RefreshIcon,
	SearchIcon,
	SettingsIcon,
	SpaceDashboardIcon,
	StarIcon,
	type ActionIconProps
} from '@/shared/ui/icons/ActionIcons'
import {
	GithubBrandIcon,
	GoogleBrandIcon,
	TelegramBrandIcon,
	VkBrandIcon,
	YandexBrandIcon,
	type BrandIconProps
} from '@/shared/ui/icons/BrandIcons'
import type { SVGProps } from 'react'

export type AppIconProps = SVGProps<SVGSVGElement> & {
	name: AppIconName
	size?: number
	fill?: string
}

type ActionIconComponent = (props: ActionIconProps) => JSX.Element
type BrandIconComponent = (props: BrandIconProps) => JSX.Element

const actionIconRegistry: Partial<
	Record<AppIconName, ActionIconComponent>
> = {
	apps: AppsIcon,
	clock: ClockIcon,
	close: CloseIcon,
	cookie: CookieIcon,
	diamond: DiamondIcon,
	edit: EditIcon,
	eye: EyeIcon,
	'eye-off': EyeOffIcon,
	help: HelpCircleIcon,
	home: HomeIcon,
	lock: LockIcon,
	login: LoginIcon,
	logout: LogoutIcon,
	menu: MenuIcon,
	'navigate-before': NavigateBeforeIcon,
	'navigate-next': NavigateNextIcon,
	payment: PaymentIcon,
	'person-add': PersonAddIcon,
	refresh: RefreshIcon,
	search: SearchIcon,
	settings: SettingsIcon,
	star: StarIcon,
	dashboard: SpaceDashboardIcon
}

const brandIconRegistry: Partial<Record<AppIconName, BrandIconComponent>> =
	{
		github: GithubBrandIcon,
		google: GoogleBrandIcon,
		telegram: TelegramBrandIcon,
		vk: VkBrandIcon,
		yandex: YandexBrandIcon
	}

const smallerActionIcons = new Set<AppIconName>(['eye', 'eye-off'])

const getDefaultColor = (name: AppIconName) =>
	smallerActionIcons.has(name) ? 'gray' : 'currentColor'

const AppIcon = ({ name, fill, color, size, ...props }: AppIconProps) => {
	const resolvedColor = color ?? fill ?? getDefaultColor(name)
	const BrandIconComponent = brandIconRegistry[name]

	if (BrandIconComponent) {
		return (
			<BrandIconComponent color={resolvedColor} size={size} {...props} />
		)
	}

	const ActionIconComponent = actionIconRegistry[name] ?? EllipsisIcon
	const resolvedSize = size ?? (smallerActionIcons.has(name) ? 20 : 24)

	return (
		<ActionIconComponent
			color={resolvedColor}
			size={resolvedSize}
			{...props}
		/>
	)
}

export default AppIcon
