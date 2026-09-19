import type { SVGProps } from 'react'

export type ActionIconProps = SVGProps<SVGSVGElement> & {
	size?: number
}

const ActionIcon = ({
	size = 20,
	children,
	style,
	...props
}: ActionIconProps) => (
	<svg
		aria-hidden="true"
		focusable="false"
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.9}
		strokeLinecap="round"
		strokeLinejoin="round"
		style={{ display: 'block', ...style }}
		{...props}
	>
		<g fill="none">{children}</g>
	</svg>
)

export const ExternalLinkIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M14.5 4.25h5.25v5.25" />
		<path d="m10.75 13.25 8.85-8.85" />
		<path d="M19.25 13.25v5.25a1.75 1.75 0 0 1-1.75 1.75h-12A1.75 1.75 0 0 1 3.75 18.5v-12A1.75 1.75 0 0 1 5.5 4.75h5.25" />
	</ActionIcon>
)

export const FileListIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M7 3.75h6.15L18 8.6v11.65H7A1.75 1.75 0 0 1 5.25 18.5v-13A1.75 1.75 0 0 1 7 3.75z" />
		<path d="M13 4v4.75h4.75" />
		<path d="M8.75 12.25h6.5" />
		<path d="M8.75 15.75h6.5" />
	</ActionIcon>
)

export const SettingsIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M4 7h6.25" />
		<path d="M13.75 7H20" />
		<circle cx="12" cy="7" r="1.8" />
		<path d="M4 17h6.25" />
		<path d="M13.75 17H20" />
		<circle cx="12" cy="17" r="1.8" />
	</ActionIcon>
)

export const StarIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="m12 3.9 2.3 4.65 5.15.75-3.73 3.63.88 5.12L12 15.63l-4.6 2.42.88-5.12L4.55 9.3l5.15-.75z" />
	</ActionIcon>
)

export const DeleteIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M4.5 7h15" />
		<path d="M9.25 7V5.75A1.75 1.75 0 0 1 11 4h2a1.75 1.75 0 0 1 1.75 1.75V7" />
		<path d="m18.25 7-.75 11.25A2 2 0 0 1 15.5 20.1h-7a2 2 0 0 1-2-1.85L5.75 7" />
		<path d="M10 11v5" />
		<path d="M14 11v5" />
	</ActionIcon>
)

export const CheckIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="m5 12.6 4.15 4.15L19.25 6.65" />
	</ActionIcon>
)

export const AppsIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<rect x="4" y="4" width="6.25" height="6.25" rx="1.55" />
		<rect x="13.75" y="4" width="6.25" height="6.25" rx="1.55" />
		<rect x="4" y="13.75" width="6.25" height="6.25" rx="1.55" />
		<rect x="13.75" y="13.75" width="6.25" height="6.25" rx="1.55" />
	</ActionIcon>
)

export const ClockIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<circle cx="12" cy="12" r="8.75" />
		<path d="M12 7.4V12l3.3 2.1" />
	</ActionIcon>
)

export const CloseIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="m6.5 6.5 11 11" />
		<path d="m17.5 6.5-11 11" />
	</ActionIcon>
)

export const CookieIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M20.3 13.1A8.25 8.25 0 1 1 10.9 3.75a3.2 3.2 0 0 0 4.35 3.8 3.15 3.15 0 0 0 3.95 3.95 3.2 3.2 0 0 0 1.1 1.6z" />
		<circle cx="8.2" cy="9.2" r=".8" fill="currentColor" stroke="none" />
		<circle
			cx="8.75"
			cy="15.25"
			r=".75"
			fill="currentColor"
			stroke="none"
		/>
		<circle
			cx="13.15"
			cy="13.1"
			r=".85"
			fill="currentColor"
			stroke="none"
		/>
		<circle cx="15.8" cy="17" r=".7" fill="currentColor" stroke="none" />
	</ActionIcon>
)

export const DiamondIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M6.15 4.25h11.7L21.2 9l-9.2 10.75L2.8 9z" />
		<path d="M3.1 9h17.8" />
		<path d="m8 9 4 10.75L16 9" />
		<path d="m6.15 4.25 1.85 4.75" />
		<path d="m17.85 4.25-1.85 4.75" />
	</ActionIcon>
)

export const DragIndicatorIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
		<circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
		<circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
		<circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
		<circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
		<circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
	</ActionIcon>
)

export const EditIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M4 20h4.25L18.6 9.65a2.3 2.3 0 0 0 0-3.25l-1-1a2.3 2.3 0 0 0-3.25 0L4 15.75z" />
		<path d="m13.25 6.5 4.25 4.25" />
		<path d="M12 20h8" />
	</ActionIcon>
)

export const EllipsisIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<circle cx="5.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
		<circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
		<circle cx="18.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
	</ActionIcon>
)

export const EyeIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M2.75 12s3.35-6.25 9.25-6.25S21.25 12 21.25 12 17.9 18.25 12 18.25 2.75 12 2.75 12z" />
		<circle cx="12" cy="12" r="2.7" />
	</ActionIcon>
)

export const EyeOffIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="m4 4 16 16" />
		<path d="M10.7 5.9c.42-.1.85-.15 1.3-.15 5.9 0 9.25 6.25 9.25 6.25a17.1 17.1 0 0 1-2.55 3.2" />
		<path d="M14.15 14.2A2.7 2.7 0 0 1 9.8 9.85" />
		<path d="M7.55 7.25C4.45 8.95 2.75 12 2.75 12s3.35 6.25 9.25 6.25c1.55 0 2.9-.42 4.05-1.05" />
	</ActionIcon>
)

export const HelpCircleIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<circle cx="12" cy="12" r="8.75" />
		<path d="M9.6 9.2a2.65 2.65 0 1 1 4.45 1.95c-.85.62-1.35 1.05-1.35 2.1" />
		<circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />
	</ActionIcon>
)

export const HomeIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="m3.75 11.25 8.25-7 8.25 7" />
		<path d="M5.75 10.2v9.05h12.5V10.2" />
		<path d="M9.75 19.25v-5.5h4.5v5.5" />
	</ActionIcon>
)

export const LockIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<rect x="4.75" y="10" width="14.5" height="10.25" rx="2" />
		<path d="M8.4 10V7.6a3.6 3.6 0 0 1 7.2 0V10" />
		<path d="M12 14.25v2.25" />
	</ActionIcon>
)

export const LoginIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M14.5 4.25h3.75a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2H14.5" />
		<path d="m10.25 8 4 4-4 4" />
		<path d="M14.25 12H3.75" />
	</ActionIcon>
)

export const LogoutIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M9.5 19.75H5.75a2 2 0 0 1-2-2V6.25a2 2 0 0 1 2-2H9.5" />
		<path d="m14 8 4 4-4 4" />
		<path d="M18 12H8.25" />
	</ActionIcon>
)

export const MenuIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M4.75 7h14.5" />
		<path d="M4.75 12h14.5" />
		<path d="M4.75 17h14.5" />
	</ActionIcon>
)

export const NavigateBeforeIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="m14.75 6.5-5.5 5.5 5.5 5.5" />
	</ActionIcon>
)

export const NavigateNextIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="m9.25 6.5 5.5 5.5-5.5 5.5" />
	</ActionIcon>
)

export const PaymentIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<rect x="3.5" y="5.25" width="17" height="13.5" rx="2.25" />
		<path d="M3.5 10h17" />
		<path d="M7 15h3" />
		<path d="M14 15h3" />
	</ActionIcon>
)

export const PersonAddIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<circle cx="9.25" cy="7.75" r="3.35" />
		<path d="M3.25 20.25v-.95a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v.95" />
		<path d="M18.5 8.25v5.5" />
		<path d="M21.25 11h-5.5" />
	</ActionIcon>
)

export const RefreshIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<path d="M19.5 7.35A8.2 8.2 0 0 0 5.1 6.2L4 8.1" />
		<path d="M4.45 4.15 4 8.1l3.95.45" />
		<path d="M4.5 16.65a8.2 8.2 0 0 0 14.4 1.15l1.1-1.9" />
		<path d="m19.55 19.85.45-3.95-3.95-.45" />
	</ActionIcon>
)

export const SearchIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<circle cx="10.8" cy="10.8" r="6.4" />
		<path d="m16.05 16.05 3.7 3.7" />
	</ActionIcon>
)

export const SpaceDashboardIcon = (props: ActionIconProps) => (
	<ActionIcon {...props}>
		<rect x="3.75" y="3.75" width="6.5" height="7.25" rx="1.7" />
		<rect x="13.75" y="3.75" width="6.5" height="4.75" rx="1.7" />
		<rect x="13.75" y="12.5" width="6.5" height="7.75" rx="1.7" />
		<rect x="3.75" y="15" width="6.5" height="5.25" rx="1.7" />
	</ActionIcon>
)
